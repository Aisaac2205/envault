import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '../../support/databases';
import { expect, test } from '../../support/pipeline-fixtures';

// A MySQL database is more than tables: views, triggers, stored routines and
// events live in it too. The restore loads the dump into a shadow database and
// swaps it in, so these objects must survive that swap. The scenario inputs are
// asserted first, because a restore that "works" on a database without these
// objects proves nothing.

const BASE_ROWS = [[1, 10]];

async function createSchemaObjects(database: string): Promise<void> {
  await withMysql(database, async (c) => {
    await c.query('CREATE TABLE t_base (id INT PRIMARY KEY, v INT NOT NULL) ENGINE=InnoDB');
    await c.query('CREATE TABLE t_src (id INT PRIMARY KEY AUTO_INCREMENT, n INT NOT NULL) ENGINE=InnoDB');
    await c.query(
      'CREATE TRIGGER trg_src_ai AFTER INSERT ON t_src FOR EACH ROW ' +
        'INSERT INTO t_base (id, v) VALUES (1000 + NEW.id, NEW.n)',
    );
    // Order matters on purpose. The second trigger only has an effect if it runs
    // after the first one (it updates the row the first one inserts), and its
    // name sorts before the first trigger's, so name order would get it wrong.
    await c.query(
      'CREATE TRIGGER trg_src_aa AFTER INSERT ON t_src FOR EACH ROW FOLLOWS trg_src_ai ' +
        'UPDATE t_base SET v = v + 1 WHERE id = 1000 + NEW.id',
    );
    await c.query('CREATE FUNCTION fn_double(x INT) RETURNS INT DETERMINISTIC RETURN x * 2');
    // Views that depend on another view and on a function; v_fn and v_top sort
    // before or after what they need, so creation needs dependency order.
    await c.query('CREATE VIEW v_base AS SELECT id, v * 2 AS doubled FROM t_base');
    await c.query('CREATE VIEW v_fn AS SELECT id, fn_double(v) AS twice FROM t_base');
    await c.query('CREATE VIEW v_top AS SELECT id, doubled FROM v_base WHERE doubled > 0');
    await c.query('CREATE PROCEDURE sp_add(IN a INT, IN b INT) SELECT a + b AS total');
    await c.query(
      'CREATE EVENT ev_daily ON SCHEDULE EVERY 1 DAY DISABLE DO UPDATE t_base SET v = v',
    );
    await c.query('INSERT INTO t_base (id, v) VALUES ?', [BASE_ROWS]);
  });
}

interface ObjectInventory {
  tables: string[];
  views: string[];
  triggers: string[];
  routines: string[];
  events: string[];
}

async function inventory(database: string): Promise<ObjectInventory> {
  return withMysql(undefined, async (c) => {
    const names = async (sql: string): Promise<string[]> => {
      const [rows] = await c.query<RowDataPacket[]>(sql, [database]);
      return rows.map((row) => row.name as string).sort();
    };
    return {
      tables: await names(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      ),
      views: await names(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'",
      ),
      triggers: await names('SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?'),
      routines: await names('SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?'),
      events: await names('SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?'),
    };
  });
}

const EXPECTED: ObjectInventory = {
  tables: ['t_base', 't_src'],
  views: ['v_base', 'v_fn', 'v_top'],
  triggers: ['trg_src_aa', 'trg_src_ai'],
  routines: ['fn_double', 'sp_add'],
  events: ['ev_daily'],
};

async function leftoverStagingDatabases(database: string): Promise<string[]> {
  return withMysql(undefined, async (c) => {
    const [rows] = await c.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ?',
      // `\\_` is a literal backslash and underscore in the pattern: LIKE would
      // treat a bare `_` as "any character".
      [`${database}\\_shadow\\_%`, `${database}\\_pre\\_restore\\_%`],
    );
    return rows.map((row) => row.name as string);
  });
}

async function expectObjectsWork(database: string): Promise<void> {
  await withMysql(database, async (c) => {
    const [view] = await c.query<RowDataPacket[]>('SELECT doubled FROM v_base WHERE id = 1');
    expect(view).toEqual([{ doubled: 20 }]);

    const [top] = await c.query<RowDataPacket[]>('SELECT doubled FROM v_top WHERE id = 1');
    expect(top, 'a view that selects from another view').toEqual([{ doubled: 20 }]);

    const [viaFn] = await c.query<RowDataPacket[]>('SELECT twice FROM v_fn WHERE id = 1');
    expect(viaFn, 'a view that calls a stored function').toEqual([{ twice: 20 }]);

    await c.query('INSERT INTO t_src (n) VALUES (7)');
    const [fired] = await c.query<RowDataPacket[]>('SELECT v FROM t_base WHERE id = 1001');
    expect(
      fired,
      'both AFTER INSERT triggers must fire, the second after the first (7, then +1)',
    ).toEqual([{ v: 8 }]);

    const [fn] = await c.query<RowDataPacket[]>('SELECT fn_double(21) AS r');
    expect(fn).toEqual([{ r: 42 }]);

    const [proc] = await c.query<RowDataPacket[][]>('CALL sp_add(2, 3)');
    expect(proc[0]).toEqual([{ total: 5 }]);
  });
}

/**
 * A probe that waited for nothing would prove nothing: DDL on the table must
 * really be blocked, with the same error the restore will get (1205).
 */
async function expectDdlBlocked(database: string, table: string): Promise<void> {
  await withMysql(database, async (probe) => {
    await probe.query('SET SESSION lock_wait_timeout = 1');
    await expect(probe.query(`ALTER TABLE ${table} COMMENT = 'probe'`)).rejects.toMatchObject({
      errno: 1205,
    });
  });
}

const ACCENTED = 'revisión';

test.describe('MySQL restore of schema objects', () => {
  test('keeps non-ASCII text in objects created under a latin1 client charset', async ({
    newDatabase,
    createConnection,
    jobs,
  }) => {
    const source = await newDatabase('mysql', 'empty');
    // A real latin1 client: mysql2 sends latin1 bytes, so the objects get
    // character_set_client = latin1 (what the mysql CLI does in a POSIX locale).
    await withMysql(
      source.name,
      async (c) => {
        await c.query('CREATE TABLE t_in (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB');
        await c.query('CREATE TABLE t_out (id INT PRIMARY KEY, note VARCHAR(50)) ENGINE=InnoDB');
        await c.query(`CREATE VIEW v_note AS SELECT '${ACCENTED}' AS note`);
        await c.query(
          `CREATE TRIGGER trg_note AFTER INSERT ON t_in FOR EACH ROW INSERT INTO t_out (id, note) VALUES (NEW.id, '${ACCENTED}')`,
        );
      },
      'LATIN1_SWEDISH_CI',
    );
    const declared = await withMysql(undefined, async (c) => {
      const [views] = await c.query<RowDataPacket[]>(
        'SELECT CHARACTER_SET_CLIENT AS cs FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?',
        [source.name],
      );
      const [triggers] = await c.query<RowDataPacket[]>(
        'SELECT CHARACTER_SET_CLIENT AS cs FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
        [source.name],
      );
      return { view: views[0]?.cs, trigger: triggers[0]?.cs };
    });
    expect(declared, 'scenario input: both objects were created under latin1').toEqual({
      view: 'latin1',
      trigger: 'latin1',
    });
    const readNote = (database: string) =>
      withMysql(database, async (c) => {
        const [rows] = await c.query<RowDataPacket[]>('SELECT note FROM v_note');
        return rows[0]?.note as string;
      });
    expect(await readNote(source.name), 'scenario input: the source view returns the text').toBe(
      ACCENTED,
    );

    const { connection: sourceConnection } = await createConnection({
      ...source.settings,
      environment: 'prod',
    });
    const backup = await jobs.backup(sourceConnection.id);
    expect(backup.status).toBe('completed');

    const target = await newDatabase('mysql', 'empty');
    const { connection: targetConnection } = await createConnection({
      ...target.settings,
      environment: 'dev',
    });
    const restore = await jobs.restore({
      sourceBackupId: backup.id,
      targetConnectionId: targetConnection.id,
    });
    expect(restore).toMatchObject({ status: 'completed', errorMessage: null });

    expect(await readNote(target.name), 'the restored view returns the exact text').toBe(ACCENTED);
    await withMysql(target.name, async (c) => {
      await c.query('INSERT INTO t_in () VALUES ()');
      const [rows] = await c.query<RowDataPacket[]>('SELECT note FROM t_out');
      expect(rows, 'the restored trigger writes the exact text').toEqual([{ note: ACCENTED }]);
    });
  });

  test('restores views, triggers, routines and events into an empty target', async ({
    newDatabase,
    createConnection,
    jobs,
  }) => {
    const source = await newDatabase('mysql', 'empty');
    await createSchemaObjects(source.name);
    expect(await inventory(source.name), 'scenario input: the source holds every object kind').toEqual(
      EXPECTED,
    );
    const { connection: sourceConnection } = await createConnection({
      ...source.settings,
      environment: 'prod',
    });
    const backup = await jobs.backup(sourceConnection.id);
    expect(backup.status).toBe('completed');

    const target = await newDatabase('mysql', 'empty');
    const { connection: targetConnection } = await createConnection({
      ...target.settings,
      environment: 'dev',
    });
    const restore = await jobs.restore({
      sourceBackupId: backup.id,
      targetConnectionId: targetConnection.id,
    });
    expect(restore).toMatchObject({ status: 'completed', errorMessage: null });

    expect(await inventory(target.name)).toEqual(EXPECTED);
    await expectObjectsWork(target.name);
    expect(await leftoverStagingDatabases(target.name)).toEqual([]);
  });

  test('restores over a target that already has a view and a table with a trigger', async ({
    newDatabase,
    createConnection,
    jobs,
  }) => {
    const source = await newDatabase('mysql', 'empty');
    await createSchemaObjects(source.name);
    expect(await inventory(source.name)).toEqual(EXPECTED);
    const { connection: sourceConnection } = await createConnection({
      ...source.settings,
      environment: 'prod',
    });
    const backup = await jobs.backup(sourceConnection.id);
    expect(backup.status).toBe('completed');

    const target = await newDatabase('mysql', 'empty');
    await withMysql(target.name, async (c) => {
      await c.query('CREATE TABLE old_main (id INT PRIMARY KEY) ENGINE=InnoDB');
      await c.query('CREATE TABLE old_log (id INT PRIMARY KEY AUTO_INCREMENT, ref INT) ENGINE=InnoDB');
      await c.query(
        'CREATE TRIGGER trg_old_ai AFTER INSERT ON old_main FOR EACH ROW INSERT INTO old_log (ref) VALUES (NEW.id)',
      );
      await c.query('CREATE VIEW v_old AS SELECT id FROM old_main');
    });
    const before = await inventory(target.name);
    expect(before.views, 'scenario input: the target holds a view').toEqual(['v_old']);
    expect(before.triggers, 'scenario input: the target holds a trigger').toEqual(['trg_old_ai']);

    const { connection: targetConnection } = await createConnection({
      ...target.settings,
      environment: 'dev',
    });
    const restore = await jobs.restore({
      sourceBackupId: backup.id,
      targetConnectionId: targetConnection.id,
    });
    expect(restore).toMatchObject({ status: 'completed', errorMessage: null });

    expect(await inventory(target.name)).toEqual(EXPECTED);
    await expectObjectsWork(target.name);
    expect(await leftoverStagingDatabases(target.name)).toEqual([]);
  });

  test('gives up when another session holds a lock on the target, leaves it intact and succeeds once it is released', async ({
    newDatabase,
    createConnection,
    jobs,
  }) => {
    const source = await newDatabase('mysql', 'empty');
    await createSchemaObjects(source.name);
    const { connection: sourceConnection } = await createConnection({
      ...source.settings,
      environment: 'prod',
    });
    const backup = await jobs.backup(sourceConnection.id);
    expect(backup.status).toBe('completed');

    const target = await newDatabase('mysql', 'empty');
    await withMysql(target.name, async (c) => {
      await c.query('CREATE TABLE old_main (id INT PRIMARY KEY) ENGINE=InnoDB');
      await c.query('CREATE TABLE old_log (id INT PRIMARY KEY AUTO_INCREMENT, ref INT) ENGINE=InnoDB');
      await c.query(
        'CREATE TRIGGER trg_old_ai AFTER INSERT ON old_main FOR EACH ROW INSERT INTO old_log (ref) VALUES (NEW.id)',
      );
      await c.query('CREATE VIEW v_old AS SELECT id FROM old_main');
      await c.query('INSERT INTO old_main (id) VALUES (1)');
    });
    const before = await inventory(target.name);
    expect(before.triggers, 'scenario input: the target holds a trigger').toEqual(['trg_old_ai']);
    expect(before.views, 'scenario input: the target holds a view').toEqual(['v_old']);

    const { connection: targetConnection } = await createConnection({
      ...target.settings,
      environment: 'dev',
    });
    const request = { sourceBackupId: backup.id, targetConnectionId: targetConnection.id };

    // The application of the target: an open transaction that has read the table
    // holds a metadata lock on it until it ends, so DROP TRIGGER and RENAME TABLE
    // on that table wait. The stack gives the restore a few seconds of patience
    // (RESTORE_LOCK_WAIT_TIMEOUT_MS) instead of the 30 s default.
    await withMysql(target.name, async (holder) => {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM old_main');
      await expectDdlBlocked(target.name, 'old_main');

      const { jobId } = await jobs.startRestore(request);
      // Without the bound the swap waits for a year (the server default), so
      // ending inside the job timeout is the proof that it is bounded.
      const failed = await jobs.waitForRestore(jobId, {
        until: (job) => job.status === 'failed' || job.status === 'completed',
        failFast: false,
        description: 'finish while another session held a lock on the target',
      });
      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toMatch(/waiting for a lock on the target database/);
      expect(failed.errorMessage).toContain('The target was left unchanged');

      // Still locked: nothing was lost, and what was dropped came back.
      expect(await inventory(target.name), 'the target keeps every table, view and trigger').toEqual(
        before,
      );
      expect(await leftoverStagingDatabases(target.name), 'no temporary database is left').toEqual([]);
      await withMysql(target.name, async (c) => {
        const [view] = await c.query<RowDataPacket[]>('SELECT id FROM v_old');
        expect(view).toEqual([{ id: 1 }]);
        await c.query('INSERT INTO old_main (id) VALUES (2)');
        const [log] = await c.query<RowDataPacket[]>('SELECT ref FROM old_log ORDER BY id');
        expect(log, 'the recreated trigger still fires').toEqual([{ ref: 1 }, { ref: 2 }]);
      });

      await holder.query('COMMIT');
    });

    const restore = await jobs.restore(request);
    expect(restore).toMatchObject({ status: 'completed', errorMessage: null });
    expect(await inventory(target.name)).toEqual(EXPECTED);
    await expectObjectsWork(target.name);
    expect(await leftoverStagingDatabases(target.name)).toEqual([]);
  });
});
