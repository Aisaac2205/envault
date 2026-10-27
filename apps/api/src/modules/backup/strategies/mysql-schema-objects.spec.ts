import {
  RestoreRollbackError,
  captureSchemaObjects,
  createSchemaObjects,
  listBaseTables,
  swapSchemaObjects,
  type MysqlSession,
} from './mysql-schema-objects';

interface FakeObjects {
  views?: Array<{ name: string; ddl: string }>;
  triggers?: Array<{ name: string; table: string; ddl: string }>;
  routines?: Array<{ name: string; kind: 'PROCEDURE' | 'FUNCTION'; ddl: string }>;
  events?: Array<{ name: string; ddl: string }>;
}

interface FakeDb extends FakeObjects {
  tables: string[];
}

const CONTEXT = {
  sql_mode: 'STRICT_TRANS_TABLES',
  character_set_client: 'latin1',
  collation_connection: 'latin1_swedish_ci',
  time_zone: '+02:00',
};

/**
 * In-memory stand-in for one mysql2 session. It answers the inventory and
 * SHOW CREATE queries from `dbs`, applies RENAME TABLE to the table lists and
 * records every statement with the session context active when it ran.
 */
class FakeSession implements MysqlSession {
  readonly log: string[] = [];
  readonly created: Array<{ ddl: string; context: Record<string, string> }> = [];
  failOn: (sql: string) => boolean = () => false;
  /** The error `failOn` raises; a lock wait timeout carries mysql2's errno/code. */
  failWith: (sql: string) => Error = (sql) => new Error(`boom: ${sql}`);
  private current = '';
  private context: Record<string, string> = {
    sql_mode: 'ORIGINAL_MODE',
    character_set_client: 'utf8mb4',
    collation_connection: 'utf8mb4_0900_ai_ci',
    time_zone: 'SYSTEM',
  };
  onStatement?: (sql: string) => void;

  constructor(readonly dbs: Record<string, FakeDb>) {}

  async query(sql: string, values: unknown[] = []): Promise<unknown> {
    this.log.push(sql);
    this.onStatement?.(sql);
    if (this.failOn(sql)) throw this.failWith(sql);
    const db = this.dbs[(values[0] as string) ?? this.current];

    let match: RegExpMatchArray | null;
    if ((match = sql.match(/^USE `(.+)`$/))) {
      this.current = match[1];
      return [[], []];
    }
    if (sql.includes('information_schema.TABLES') && sql.includes("'BASE TABLE'")) {
      return [db.tables.map((name) => ({ name })), []];
    }
    if (sql.includes('information_schema.TABLES') && sql.includes("'VIEW'")) {
      return [(db.views ?? []).map(({ name }) => ({ name })), []];
    }
    if (sql.includes('information_schema.TRIGGERS')) {
      return [(db.triggers ?? []).map(({ name, table }) => ({ name, tableName: table })), []];
    }
    if (sql.includes('information_schema.ROUTINES')) {
      return [(db.routines ?? []).map(({ name, kind }) => ({ name, kind })), []];
    }
    if (sql.includes('information_schema.EVENTS')) {
      return [(db.events ?? []).map(({ name }) => ({ name })), []];
    }
    if ((match = sql.match(/^SHOW CREATE (VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT) `(.+)`$/))) {
      return [[this.showCreate(match[1], match[2])], []];
    }
    if (sql.startsWith('SELECT @@SESSION')) {
      const c = this.context;
      return [
        [{ sqlMode: c.sql_mode, charset: c.character_set_client, collation: c.collation_connection, timeZone: c.time_zone }],
        [],
      ];
    }
    if (sql.startsWith('SET @@SESSION')) {
      const variables = [...sql.matchAll(/@@SESSION\.(\w+)/g)].map((m) => m[1]);
      variables.forEach((variable, i) => (this.context[variable] = values[i] as string));
      return [[], []];
    }
    if (sql.startsWith('RENAME TABLE')) {
      for (const [, from, table, to] of sql.matchAll(/`([^`]+)`\.`([^`]+)` TO `([^`]+)`\./g)) {
        this.dbs[from].tables = this.dbs[from].tables.filter((t) => t !== table);
        this.dbs[to].tables.push(table);
      }
      return [[], []];
    }
    // Triggers and views are tracked so the rollback can ask which ones are missing.
    if ((match = sql.match(/^DROP (TRIGGER|VIEW) IF EXISTS `([^`]+)`\.`([^`]+)`$/))) {
      const key = match[1] === 'VIEW' ? 'views' : 'triggers';
      const owner = this.dbs[match[2]];
      owner[key] = (owner[key] ?? []).filter((o) => o.name !== match![3]) as never;
      return [[], []];
    }
    if (sql.startsWith('CREATE')) {
      this.created.push({ ddl: sql, context: { ...this.context } });
      if ((match = sql.match(/^CREATE (TRIGGER|VIEW) `([^`]+)`/))) {
        const owner = this.dbs[this.current];
        if (match[1] === 'VIEW') {
          (owner.views ??= []).push({ name: match[2], ddl: sql });
        } else {
          (owner.triggers ??= []).push({ name: match[2], table: '', ddl: sql });
        }
      }
    }
    return [[], []];
  }

  private showCreate(kind: string, name: string): Record<string, string> {
    const db = this.dbs[this.current];
    const find = <T extends { name: string; ddl: string }>(list: T[] = []) =>
      list.find((o) => o.name === name)!;
    switch (kind) {
      case 'VIEW':
        return {
          'Create View': find(db.views).ddl,
          character_set_client: CONTEXT.character_set_client,
          collation_connection: CONTEXT.collation_connection,
        };
      case 'TRIGGER':
        return { 'SQL Original Statement': find(db.triggers).ddl, ...CONTEXT };
      case 'EVENT':
        return { 'Create Event': find(db.events).ddl, ...CONTEXT };
      case 'PROCEDURE':
        return { 'Create Procedure': find(db.routines).ddl, ...CONTEXT };
      default:
        return { 'Create Function': find(db.routines).ddl, ...CONTEXT };
    }
  }
}

function fixtureDbs(): Record<string, FakeDb> {
  return {
    app: {
      tables: ['old_a'],
      views: [{ name: 'v_old', ddl: 'CREATE VIEW `v_old` AS select 1' }],
      triggers: [{ name: 'trg_old', table: 'old_a', ddl: 'CREATE TRIGGER `trg_old` ...' }],
      routines: [{ name: 'fn_old', kind: 'FUNCTION', ddl: 'CREATE FUNCTION `fn_old` ...' }],
      events: [{ name: 'ev_old', ddl: 'CREATE EVENT `ev_old` ...' }],
    },
    app_shadow: {
      tables: ['t_src', 't_base'],
      // Listed in name order; a_view needs z_view, so name order is not creation order.
      views: [
        { name: 'a_view', ddl: 'CREATE VIEW `a_view` AS select * from `z_view`' },
        { name: 'z_view', ddl: 'CREATE VIEW `z_view` AS select * from `t_base`' },
      ],
      triggers: [
        { name: 'trg_first', table: 't_src', ddl: 'CREATE TRIGGER `trg_first` ...' },
        { name: 'trg_second', table: 't_src', ddl: 'CREATE TRIGGER `trg_second` ...' },
      ],
      routines: [
        { name: 'fn_double', kind: 'FUNCTION', ddl: 'CREATE FUNCTION `fn_double` ...' },
        { name: 'sp_add', kind: 'PROCEDURE', ddl: 'CREATE PROCEDURE `sp_add` ...' },
      ],
      events: [{ name: 'ev_daily', ddl: 'CREATE EVENT `ev_daily` ...' }],
    },
    app_pre_restore_1: { tables: [] },
  };
}

const OPTIONS = {
  database: 'app',
  shadowDb: 'app_shadow',
  backupDb: 'app_pre_restore_1',
  onLog: () => undefined,
};

/** Makes z_view uncreatable until t_base exists, and a_view until z_view does. */
function enforceViewDependencies(session: FakeSession): void {
  session.failOn = (sql) => {
    const created = (ddl: string) => session.created.some((c) => c.ddl.includes(ddl));
    if (sql.startsWith('CREATE VIEW `a_view`')) return !created('CREATE VIEW `z_view`');
    return false;
  };
}

describe('mysql-schema-objects', () => {
  describe('listBaseTables', () => {
    it('asks for BASE TABLEs only, never SHOW TABLES', async () => {
      const session = new FakeSession(fixtureDbs());

      await expect(listBaseTables(session, 'app_shadow')).resolves.toEqual(['t_src', 't_base']);

      expect(session.log[0]).toContain("TABLE_TYPE = 'BASE TABLE'");
      expect(session.log.join('\n')).not.toContain('SHOW TABLES');
    });
  });

  describe('captureSchemaObjects', () => {
    it('captures definitions under USE <db> with their session context', async () => {
      const session = new FakeSession(fixtureDbs());

      const captured = await captureSchemaObjects(session, 'app_shadow');

      expect(session.log[0]).toBe('USE `app_shadow`');
      expect(captured.views.map((v) => v.name)).toEqual(['a_view', 'z_view']);
      expect(captured.triggers.map((t) => [t.name, t.table])).toEqual([
        ['trg_first', 't_src'],
        ['trg_second', 't_src'],
      ]);
      expect(captured.routines.map((r) => [r.kind, r.name])).toEqual([
        ['FUNCTION', 'fn_double'],
        ['PROCEDURE', 'sp_add'],
      ]);
      expect(captured.events[0].context).toEqual({
        sqlMode: 'STRICT_TRANS_TABLES',
        charset: 'latin1',
        collation: 'latin1_swedish_ci',
        timeZone: '+02:00',
      });
      expect(captured.views[0].context).toEqual({
        sqlMode: undefined,
        charset: 'latin1',
        collation: 'latin1_swedish_ci',
        timeZone: undefined,
      });
    });

    it('fails clearly when a definition cannot be read', async () => {
      const dbs = fixtureDbs();
      dbs.app_shadow.routines = [{ name: 'sp_add', kind: 'PROCEDURE', ddl: '' }];
      const session = new FakeSession(dbs);

      await expect(captureSchemaObjects(session, 'app_shadow')).rejects.toThrow(
        /Cannot read the definition of procedure sp_add/,
      );
    });
  });

  describe('createSchemaObjects', () => {
    it('creates routines, then views by dependency, then triggers in action order, then events', async () => {
      const session = new FakeSession(fixtureDbs());
      const captured = await captureSchemaObjects(session, 'app_shadow');
      enforceViewDependencies(session);

      await createSchemaObjects(session, 'app', captured);

      const names = session.created.map((c) => /`(\w+)`/.exec(c.ddl)![1]);
      expect(names).toEqual([
        'fn_double',
        'sp_add',
        'z_view',
        'a_view',
        'trg_first',
        'trg_second',
        'ev_daily',
      ]);
    });

    it('applies each object context while it is created and restores the session after', async () => {
      const session = new FakeSession(fixtureDbs());
      const captured = await captureSchemaObjects(session, 'app_shadow');

      await createSchemaObjects(session, 'app', captured);

      for (const created of session.created) {
        expect(created.context).toMatchObject({
          character_set_client: 'latin1',
          collation_connection: 'latin1_swedish_ci',
        });
      }
      const event = session.created.find((c) => c.ddl.startsWith('CREATE EVENT'))!;
      expect(event.context).toMatchObject({ sql_mode: 'STRICT_TRANS_TABLES', time_zone: '+02:00' });
      // The last statement after the final CREATE put the original context back.
      expect(session.log[session.log.length - 1]).toMatch(/^SET @@SESSION\.sql_mode = \?/);
      expect((session as unknown as { context: Record<string, string> }).context).toEqual({
        sql_mode: 'ORIGINAL_MODE',
        character_set_client: 'utf8mb4',
        collation_connection: 'utf8mb4_0900_ai_ci',
        time_zone: 'SYSTEM',
      });
    });

    it('restores the session even when a definition fails', async () => {
      const session = new FakeSession(fixtureDbs());
      const captured = await captureSchemaObjects(session, 'app_shadow');
      session.failOn = (sql) => sql.startsWith('CREATE EVENT');

      await expect(createSchemaObjects(session, 'app', captured)).rejects.toThrow(/boom/);

      expect(
        (session as unknown as { context: Record<string, string> }).context.sql_mode,
      ).toBe('ORIGINAL_MODE');
    });

    it('fails clearly when views cannot be ordered', async () => {
      const dbs = fixtureDbs();
      const session = new FakeSession(dbs);
      const captured = await captureSchemaObjects(session, 'app_shadow');
      session.failOn = (sql) => sql.startsWith('CREATE VIEW');

      await expect(createSchemaObjects(session, 'app', captured)).rejects.toThrow(
        /Could not create view\(s\) a_view, z_view/,
      );
    });
  });

  describe('swapSchemaObjects', () => {
    it('swaps base tables once, then drops old routines/events and recreates the shadow objects', async () => {
      const session = new FakeSession(fixtureDbs());
      enforceViewDependencies(session);

      await swapSchemaObjects(session, OPTIONS);

      const renames = session.log.filter((s) => s.startsWith('RENAME TABLE'));
      expect(renames).toHaveLength(1);
      expect(renames[0]).toBe(
        'RENAME TABLE `app`.`old_a` TO `app_pre_restore_1`.`old_a`, ' +
          '`app_shadow`.`t_src` TO `app`.`t_src`, `app_shadow`.`t_base` TO `app`.`t_base`',
      );
      expect(session.dbs.app.tables).toEqual(['t_src', 't_base']);
      expect(session.dbs.app_pre_restore_1.tables).toEqual(['old_a']);

      const log = session.log;
      const at = (prefix: string) => log.findIndex((s) => s.startsWith(prefix));
      expect(at('DROP TRIGGER IF EXISTS `app`.`trg_old`')).toBeLessThan(at('RENAME TABLE'));
      expect(at('DROP VIEW IF EXISTS `app`.`v_old`')).toBeLessThan(at('RENAME TABLE'));
      expect(at('DROP TRIGGER IF EXISTS `app_shadow`.`trg_first`')).toBeLessThan(at('RENAME TABLE'));
      expect(at('DROP FUNCTION IF EXISTS `app`.`fn_old`')).toBeGreaterThan(at('RENAME TABLE'));
      expect(at('DROP EVENT IF EXISTS `app`.`ev_old`')).toBeGreaterThan(at('RENAME TABLE'));
      expect(at('DROP FUNCTION IF EXISTS `app`.`fn_old`')).toBeLessThan(at('CREATE FUNCTION'));
      expect(log.indexOf('SET FOREIGN_KEY_CHECKS = 0')).toBeLessThan(at('RENAME TABLE'));
      expect(log[log.indexOf(renames[0]) + 1]).toBe('SET FOREIGN_KEY_CHECKS = 1');
      expect(session.created.map((c) => c.ddl.split(' ')[1])).toEqual([
        'FUNCTION',
        'PROCEDURE',
        'VIEW',
        'VIEW',
        'TRIGGER',
        'TRIGGER',
        'EVENT',
      ]);
    });

    it('rolls back when creating an object fails: rename reversed, old objects recreated', async () => {
      const session = new FakeSession(fixtureDbs());
      session.failOn = (sql) => sql.startsWith('CREATE EVENT `ev_daily`');

      await expect(swapSchemaObjects(session, OPTIONS)).rejects.toThrow(/boom/);

      expect(session.dbs.app.tables).toEqual(['old_a']);
      expect(session.dbs.app_shadow.tables.sort()).toEqual(['t_base', 't_src']);
      expect(session.dbs.app_pre_restore_1.tables).toEqual([]);
      const afterFailure = session.created.slice(-4).map((c) => c.ddl);
      expect(afterFailure).toEqual([
        'CREATE FUNCTION `fn_old` ...',
        'CREATE VIEW `v_old` AS select 1',
        'CREATE TRIGGER `trg_old` ...',
        'CREATE EVENT `ev_old` ...',
      ]);
      // The objects created from the dump were dropped before the rename was reversed.
      const dropNew = session.log.lastIndexOf('DROP VIEW IF EXISTS `app`.`a_view`');
      const reverse = session.log.lastIndexOf(
        'RENAME TABLE `app`.`t_src` TO `app_shadow`.`t_src`, `app`.`t_base` TO `app_shadow`.`t_base`, ' +
          '`app_pre_restore_1`.`old_a` TO `app`.`old_a`',
      );
      expect(dropNew).toBeGreaterThan(-1);
      expect(reverse).toBeGreaterThan(dropNew);
    });

    it('rolls back without reversing a rename that never happened', async () => {
      const session = new FakeSession(fixtureDbs());
      session.failOn = (sql) => sql.startsWith('RENAME TABLE');

      await expect(swapSchemaObjects(session, OPTIONS)).rejects.toThrow(/boom/);

      expect(session.log.filter((s) => s.startsWith('RENAME TABLE'))).toHaveLength(1);
      expect(session.dbs.app.tables).toEqual(['old_a']);
      // The rename failed, so routines and events were never touched.
      expect(session.created.map((c) => c.ddl)).toEqual([
        'CREATE VIEW `v_old` AS select 1',
        'CREATE TRIGGER `trg_old` ...',
      ]);
      expect(session.log.some((s) => /^DROP (FUNCTION|PROCEDURE|EVENT)/.test(s))).toBe(false);
    });

    it('recreates nothing when the very first drop fails, since nothing was dropped', async () => {
      const session = new FakeSession(fixtureDbs());
      let failed = false;
      session.failOn = (sql) => {
        if (failed || !sql.startsWith('DROP TRIGGER IF EXISTS `app`.`trg_old`')) return false;
        return (failed = true);
      };

      await expect(swapSchemaObjects(session, OPTIONS)).rejects.toThrow(/boom/);

      expect(session.log.some((s) => s.startsWith('RENAME TABLE'))).toBe(false);
      expect(session.log.some((s) => /^DROP (FUNCTION|PROCEDURE|EVENT)/.test(s))).toBe(false);
      expect(session.created).toEqual([]);
      expect(session.dbs.app.tables).toEqual(['old_a']);
    });

    it('recreates only what was dropped and never re-runs a DROP when it fails before the rename', async () => {
      const session = new FakeSession(fixtureDbs());
      let failed = false;
      session.failOn = (sql) => {
        if (failed || !sql.startsWith('DROP VIEW IF EXISTS `app`.`v_old`')) return false;
        return (failed = true);
      };

      await expect(swapSchemaObjects(session, OPTIONS)).rejects.toThrow(/boom/);

      expect(session.log.some((s) => s.startsWith('RENAME TABLE'))).toBe(false);
      expect(session.log.some((s) => /^DROP (FUNCTION|PROCEDURE|EVENT)/.test(s))).toBe(false);
      // The trigger was dropped before the view failed; the view was never dropped.
      expect(session.created.map((c) => c.ddl)).toEqual(['CREATE TRIGGER `trg_old` ...']);
      // A persistent lock holder would block a repeated DROP all over again.
      const failedAt = session.log.findIndex((s) => s.startsWith('DROP VIEW IF EXISTS `app`.`v_old`'));
      expect(session.log.slice(failedAt + 1).filter((s) => s.startsWith('DROP'))).toEqual([]);
      expect(session.dbs.app.tables).toEqual(['old_a']);
    });

    it('does not turn a failed recreate of untouched routines into a rollback error', async () => {
      const session = new FakeSession(fixtureDbs());
      let failed = false;
      session.failOn = (sql) => {
        if (sql.startsWith('CREATE FUNCTION `fn_old`')) return true;
        if (failed || !sql.startsWith('DROP VIEW IF EXISTS `app`.`v_old`')) return false;
        return (failed = true);
      };

      const error = await swapSchemaObjects(session, OPTIONS).catch((e: unknown) => e);

      expect(error).not.toBeInstanceOf(RestoreRollbackError);
      expect((error as Error).message).toContain('boom');
    });

    it('throws RestoreRollbackError naming the pre-restore database when the rollback fails', async () => {
      const session = new FakeSession(fixtureDbs());
      session.failOn = (sql) =>
        sql.startsWith('CREATE EVENT `ev_daily`') || sql.startsWith('CREATE FUNCTION `fn_old`');

      const error = await swapSchemaObjects(session, OPTIONS).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RestoreRollbackError);
      expect((error as RestoreRollbackError).backupDb).toBe('app_pre_restore_1');
      expect((error as RestoreRollbackError).backupIsEmpty).toBe(false);
      expect((error as Error).message).toContain('preserved in database app_pre_restore_1');
    });

    describe('lock wait timeouts', () => {
      const lockWait = () =>
        Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), {
          code: 'ER_LOCK_WAIT_TIMEOUT',
          errno: 1205,
        });
      const options = { ...OPTIONS, lockWaitTimeoutSeconds: 5 };

      /** Raises a lock wait timeout on the first statement starting with `prefix`. */
      function timeOutOn(session: FakeSession, prefix: string): void {
        let raised = false;
        session.failOn = (sql) => !raised && sql.startsWith(prefix) && (raised = true);
        session.failWith = lockWait;
      }

      it('names the stage and says the target was left unchanged once the rollback succeeded', async () => {
        const session = new FakeSession(fixtureDbs());
        timeOutOn(session, 'RENAME TABLE');

        const error = await swapSchemaObjects(session, options).catch((e: unknown) => e);

        expect(error).not.toBeInstanceOf(RestoreRollbackError);
        expect((error as Error).message).toBe(
          'Timed out after 5 s waiting for a lock on the target database while renaming the tables; ' +
            'another session is using the target tables. The target was left unchanged.',
        );
        expect(session.dbs.app.tables).toEqual(['old_a']);
        expect(session.created.map((c) => c.ddl)).toEqual([
          'CREATE VIEW `v_old` AS select 1',
          'CREATE TRIGGER `trg_old` ...',
        ]);
      });

      it.each([
        ['DROP TRIGGER IF EXISTS `app`.`trg_old`', 'dropping the triggers and views of the target'],
        ['CREATE EVENT `ev_daily`', 'recreating the restored objects'],
        ['SHOW CREATE TRIGGER', 'reading the object definitions'],
      ])('names the stage of a timeout on %s', async (prefix, stage) => {
        const session = new FakeSession(fixtureDbs());
        timeOutOn(session, prefix);

        const error = await swapSchemaObjects(session, options).catch((e: unknown) => e);

        expect((error as Error).message).toContain(`waiting for a lock on the target database while ${stage};`);
        expect(session.dbs.app.tables).toEqual(['old_a']);
      });

      it('leaves the target alone when the definitions cannot be read', async () => {
        const session = new FakeSession(fixtureDbs());
        timeOutOn(session, 'SHOW CREATE TRIGGER');

        await swapSchemaObjects(session, options).catch(() => undefined);

        expect(session.log.filter((s) => /^(DROP|RENAME|CREATE)/.test(s))).toEqual([]);
      });

      it('omits the duration when the session limit is not known', async () => {
        const session = new FakeSession(fixtureDbs());
        timeOutOn(session, 'RENAME TABLE');

        const error = await swapSchemaObjects(session, OPTIONS).catch((e: unknown) => e);

        expect((error as Error).message).toMatch(/^Timed out waiting for a lock on the target database/);
      });

      it('does not claim the target is unchanged when the rollback failed, and names what is missing', async () => {
        const session = new FakeSession(fixtureDbs());
        let raised = false;
        session.failOn = (sql) => {
          if (sql.startsWith('CREATE TRIGGER `trg_old`')) return true;
          return !raised && sql.startsWith('RENAME TABLE') && (raised = true);
        };
        session.failWith = (sql) => (sql.startsWith('RENAME') ? lockWait() : new Error('boom: trigger'));

        const error = await swapSchemaObjects(session, options).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RestoreRollbackError);
        const rollbackError = error as RestoreRollbackError;
        expect(rollbackError.message).toContain('Timed out after 5 s waiting for a lock');
        expect(rollbackError.message).not.toContain('left unchanged');
        // The tables never moved, so the pre-restore database is empty and may go.
        expect(rollbackError.backupIsEmpty).toBe(true);
        expect(rollbackError.message).toContain(
          'still in the target database and app_pre_restore_1 is empty',
        );
        // The view was recreated before the trigger failed; only the trigger is missing.
        expect(rollbackError.message).toContain('recreated by hand: trigger trg_old.');
        expect(rollbackError.message).not.toContain('view v_old');
        expect(rollbackError.message).not.toContain('preserved in database');
      });
    });

    describe('what the rollback knows about the rename', () => {
      it('keeps the pre-restore database when the swap state cannot be read', async () => {
        const session = new FakeSession(fixtureDbs());
        let renameFailed = false;
        session.failOn = (sql) => {
          if (sql.startsWith('RENAME TABLE')) return (renameFailed = true);
          return renameFailed && sql.includes("'BASE TABLE'");
        };

        const error = await swapSchemaObjects(session, OPTIONS).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RestoreRollbackError);
        expect((error as RestoreRollbackError).backupIsEmpty).toBe(false);
        expect((error as Error).message).toContain('may be in the target database or in app_pre_restore_1');
      });

      it('keeps the pre-restore database when it holds tables although the shadow still does', async () => {
        const dbs = fixtureDbs();
        dbs.app_pre_restore_1.tables = ['stray'];
        const session = new FakeSession(dbs);
        session.failOn = (sql) => sql.startsWith('RENAME TABLE');

        const error = await swapSchemaObjects(session, OPTIONS).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RestoreRollbackError);
        expect((error as RestoreRollbackError).backupIsEmpty).toBe(false);
        expect(dbs.app_pre_restore_1.tables).toEqual(['stray']);
        // Nothing was changed to "repair" a state the rollback could not trust.
        expect(session.created).toEqual([]);
      });
    });

    it('refuses an empty shadow database before touching the target', async () => {
      const dbs = fixtureDbs();
      dbs.app_shadow.tables = [];
      const session = new FakeSession(dbs);

      await expect(swapSchemaObjects(session, OPTIONS)).rejects.toThrow(
        /shadow database app_shadow has no base tables/,
      );

      // No DROP/RENAME/CREATE ran, so there is nothing to roll back either.
      const destructive = session.log.filter((s) => /^(DROP|RENAME|CREATE)/.test(s));
      expect(destructive).toEqual([]);
      expect(session.dbs.app.tables).toEqual(['old_a']);
    });

    it('honors an abort requested before the critical section', async () => {
      const session = new FakeSession(fixtureDbs());
      const controller = new AbortController();
      controller.abort();

      await expect(
        swapSchemaObjects(session, { ...OPTIONS, abortSignal: controller.signal }),
      ).rejects.toThrow('Operación cancelada por el usuario');

      const destructive = session.log.filter((s) => /^(DROP|RENAME|CREATE)/.test(s));
      expect(destructive).toEqual([]);
    });

    it('does not abort midway once the critical section has begun', async () => {
      const session = new FakeSession(fixtureDbs());
      const controller = new AbortController();
      session.onStatement = (sql) => {
        if (sql.startsWith('DROP TRIGGER IF EXISTS `app`.`trg_old`')) controller.abort();
      };

      await swapSchemaObjects(session, { ...OPTIONS, abortSignal: controller.signal });

      expect(controller.signal.aborted).toBe(true);
      expect(session.dbs.app.tables).toEqual(['t_src', 't_base']);
      expect(session.created).toHaveLength(7);
    });
  });
});
