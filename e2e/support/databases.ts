import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { Client } from 'pg';
import { MYSQL_HOST_PORT, POSTGRES_HOST_PORT } from './env';
import {
  fingerprint,
  itemRows,
  SEED_TABLES,
  tagRows,
  type Cell,
  type Fingerprint,
  type SeedRow,
} from './seed-data';
import { MYSQL_ADMIN, POSTGRES_SOURCE, type SourceDatabase } from './sources';
import { uniqueId } from './unique';

/**
 * Direct access to the two source database servers of the stack, from the host
 * (the published ports; the API reaches the same servers as `db-test-pg` and
 * `db-test-mysql`). The pipeline specs use it to create the databases they back
 * up and restore into, and to read them back to compare data.
 */

export type DbType = SourceDatabase['dbType'];

export interface Engine {
  readonly dbType: DbType;
  /** The connection settings that make the API reach `database` on this server. */
  settings(database: string): SourceDatabase;
  /** The server's own version string, as `SHOW server_version` / `VERSION()` report it. */
  serverVersion(): Promise<string>;
  createDatabase(name: string): Promise<void>;
  /** Creates the seeded tables in an existing, empty database and fills them. */
  seed(name: string): Promise<void>;
  /**
   * Drops the database and, on MySQL, the staging databases that a restore
   * leaves behind when it dies half-way. A database that is already gone is fine.
   */
  drop(name: string): Promise<void>;
  /** Structure and data of a database, for comparing a restore with its source. */
  inspect(name: string): Promise<Fingerprint>;
}

/** `e2e_<label>_<id>`: unique, and a valid unquoted identifier on both engines. */
export function uniqueDatabaseName(label: string): string {
  return `e2e_${label}_${uniqueId()}`;
}

// A multi-row INSERT of this many rows stays far below both engines' limits.
const INSERT_BATCH = 500;

function batches(rows: SeedRow[]): SeedRow[][] {
  const result: SeedRow[][] = [];
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    result.push(rows.slice(start, start + INSERT_BATCH));
  }
  return result;
}

function unreachable(what: string, error: unknown): Error {
  // A refused connection to `localhost` fails on every address it resolves to,
  // and Node reports that as an AggregateError whose message is empty: the
  // error code (ECONNREFUSED) is what says what happened.
  const { code, message } = error as NodeJS.ErrnoException;
  const reason = [code, message].filter(Boolean).join(' ') || String(error);
  return new Error(`Cannot reach ${what} from the host: ${reason}. Is the stack up (pnpm docker:e2e)?`);
}

// ── PostgreSQL ──────────────────────────────────────────────────

async function connectPostgres(database: string): Promise<Client> {
  const client = new Client({
    host: 'localhost',
    port: POSTGRES_HOST_PORT,
    user: POSTGRES_SOURCE.username,
    password: POSTGRES_SOURCE.password,
    database,
  });
  try {
    await client.connect();
  } catch (error) {
    throw unreachable(`the source PostgreSQL (localhost:${POSTGRES_HOST_PORT})`, error);
  }
  return client;
}

export async function withPostgres<T>(database: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = await connectPostgres(database);
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const quotePostgres = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

async function insertPostgres(
  client: Client,
  table: string,
  columns: string[],
  rows: SeedRow[],
): Promise<void> {
  for (const batch of batches(rows)) {
    const tuples = batch.map(
      (_, row) => `(${columns.map((_column, column) => `$${row * columns.length + column + 1}`).join(', ')})`,
    );
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, batch.flat());
  }
}

const postgres: Engine = {
  dbType: 'postgres',

  settings: (database) => ({ ...POSTGRES_SOURCE, database }),

  serverVersion: () =>
    withPostgres('postgres', async (client) => {
      const { rows } = await client.query<{ server_version: string }>('SHOW server_version');
      return rows[0].server_version;
    }),

  async createDatabase(name) {
    await withPostgres('postgres', (client) => client.query(`CREATE DATABASE ${quotePostgres(name)}`));
  },

  async seed(name) {
    await withPostgres(name, async (client) => {
      await client.query(
        'CREATE TABLE e2e_items (id integer PRIMARY KEY, label text, amount numeric(12,2), note text)',
      );
      await client.query('CREATE INDEX e2e_items_label_idx ON e2e_items (label)');
      await client.query(
        'CREATE TABLE e2e_tags (id integer PRIMARY KEY, item_id integer NOT NULL REFERENCES e2e_items (id), tag text NOT NULL)',
      );
      await insertPostgres(client, 'e2e_items', ['id', 'label', 'amount', 'note'], itemRows());
      await insertPostgres(client, 'e2e_tags', ['id', 'item_id', 'tag'], tagRows());
    });
  },

  async drop(name) {
    // FORCE ends sessions that a dump or restore that was cut short left open.
    await withPostgres('postgres', (client) =>
      client.query(`DROP DATABASE IF EXISTS ${quotePostgres(name)} WITH (FORCE)`),
    );
  },

  inspect: (name) =>
    withPostgres(name, async (client) => {
      const names = async (sql: string): Promise<string[]> =>
        (await client.query<{ name: string }>(sql)).rows.map((row) => row.name);

      const tableNames = await names(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const structure = [
        ...tableNames.map((table) => `table:${table}`),
        ...(
          await names(
            "SELECT conrelid::regclass::text || '.' || conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace",
          )
        ).map((constraint) => `constraint:${constraint}`),
        ...(await names("SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'")).map(
          (index) => `index:${index}`,
        ),
      ];

      const tables: Record<string, Cell[][]> = {};
      for (const table of SEED_TABLES.filter((seeded) => tableNames.includes(seeded))) {
        const result = await client.query({ text: `SELECT * FROM ${table} ORDER BY id`, rowMode: 'array' });
        tables[table] = result.rows;
      }
      return fingerprint(structure, tables);
    }),
};

// ── MySQL ───────────────────────────────────────────────────────

export async function withMysql<T>(
  database: string | undefined,
  run: (connection: Connection) => Promise<T>,
): Promise<T> {
  let connection: Connection;
  try {
    connection = await createConnection({
      host: 'localhost',
      port: MYSQL_HOST_PORT,
      user: MYSQL_ADMIN.username,
      password: MYSQL_ADMIN.password,
      database,
    });
  } catch (error) {
    throw unreachable(`the source MySQL (localhost:${MYSQL_HOST_PORT})`, error);
  }
  try {
    return await run(connection);
  } finally {
    await connection.end();
  }
}

const quoteMysql = (identifier: string): string => `\`${identifier.replace(/`/g, '``')}\``;

/** Makes `value` match itself literally in a LIKE pattern. */
const escapeLike = (value: string): string => value.replace(/[\\_%]/g, '\\$&');

async function insertMysql(
  connection: Connection,
  table: string,
  columns: string[],
  rows: SeedRow[],
): Promise<void> {
  for (const batch of batches(rows)) {
    await connection.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [batch]);
  }
}

const mysql: Engine = {
  dbType: 'mysql',

  settings: (database) => ({ ...MYSQL_ADMIN, database }),

  serverVersion: () =>
    withMysql(undefined, async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version');
      return rows[0].version as string;
    }),

  async createDatabase(name) {
    await withMysql(undefined, (connection) =>
      connection.query(`CREATE DATABASE ${quoteMysql(name)} CHARACTER SET utf8mb4`),
    );
  },

  async seed(name) {
    await withMysql(name, async (connection) => {
      await connection.query(
        'CREATE TABLE e2e_items (id INT PRIMARY KEY, label VARCHAR(255) NULL, amount DECIMAL(12,2) NULL, ' +
          'note TEXT NULL, KEY e2e_items_label_idx (label)) ENGINE=InnoDB',
      );
      await connection.query(
        'CREATE TABLE e2e_tags (id INT PRIMARY KEY, item_id INT NOT NULL, tag VARCHAR(255) NOT NULL, ' +
          'CONSTRAINT e2e_tags_item_fk FOREIGN KEY (item_id) REFERENCES e2e_items (id)) ENGINE=InnoDB',
      );
      await insertMysql(connection, 'e2e_items', ['id', 'label', 'amount', 'note'], itemRows());
      await insertMysql(connection, 'e2e_tags', ['id', 'item_id', 'tag'], tagRows());
    });
  },

  drop: (name) =>
    withMysql(undefined, async (connection) => {
      // A restore works in `<db>_shadow_<ts>` and parks the old tables in
      // `<db>_pre_restore_<ts>`; both normally disappear, but not if it was killed.
      const like = escapeLike(name);
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ' +
          'WHERE SCHEMA_NAME = ? OR SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ?',
        [name, `${like}\\_shadow\\_%`, `${like}\\_pre\\_restore\\_%`],
      );
      for (const row of rows) {
        await connection.query(`DROP DATABASE IF EXISTS ${quoteMysql(row.name as string)}`);
      }
    }),

  inspect: (name) =>
    withMysql(name, async (connection) => {
      const names = async (sql: string): Promise<string[]> => {
        const [rows] = await connection.query<RowDataPacket[]>(sql, [name]);
        return rows.map((row) => row.name as string);
      };

      const tableNames = await names(
        'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      );
      const structure = [
        ...tableNames.map((table) => `table:${table}`),
        ...(
          await names(
            "SELECT CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) AS name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?",
          )
        ).map((constraint) => `constraint:${constraint}`),
        ...(
          await names(
            "SELECT DISTINCT CONCAT(TABLE_NAME, '.', INDEX_NAME) AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?",
          )
        ).map((index) => `index:${index}`),
      ];

      const tables: Record<string, Cell[][]> = {};
      for (const table of SEED_TABLES.filter((seeded) => tableNames.includes(seeded))) {
        const [rows] = await connection.query({
          sql: `SELECT * FROM ${quoteMysql(table)} ORDER BY id`,
          rowsAsArray: true,
        });
        tables[table] = rows as Cell[][];
      }
      return fingerprint(structure, tables);
    }),
};

export const engines: Record<DbType, Engine> = { postgres, mysql };

/**
 * Keeps a dump of a seeded PostgreSQL database waiting: an open transaction
 * holds an exclusive lock on a table, and `pg_dump` needs a share lock on it.
 * A backup started meanwhile stays `running` (and keeps the connection's
 * backup lease) until the returned function lets go. Calling it again is harmless.
 */
export async function lockPostgresTable(name: string): Promise<() => Promise<void>> {
  const client = await connectPostgres(name);
  // Dropping the database with FORCE, as the cleanup does, cuts this session;
  // an unhandled 'error' event would take the worker down with it.
  client.on('error', () => undefined);
  await client.query('BEGIN');
  await client.query('LOCK TABLE e2e_items IN ACCESS EXCLUSIVE MODE');

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
