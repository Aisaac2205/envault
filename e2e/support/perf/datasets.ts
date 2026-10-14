import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { Client } from 'pg';
import { withMysql, withPostgres, type DbType } from '../databases';
import { TARGET_MIB, type SizeName } from './config';

/**
 * The databases the performance suite backs up. They are generated inside the
 * database server with set-based SQL (`generate_series` on PostgreSQL, an
 * insert-select over a doubled number table on MySQL), so a 500 MiB source takes
 * seconds to build instead of the minutes a row-by-row client would need.
 *
 * Every value is a function of the row id (hashes, modulo arithmetic), so the
 * same size always yields the same rows and two runs are comparable. The mix is
 * meant to look like an application database and not to compress away:
 *
 *   perf_customers  uuid, text, e-mail, decimal, timestamp, JSON profile; a unique index
 *   perf_orders     4 per customer; foreign key to the customer; uuid, status, JSON, text
 *   perf_events     4 per order (16 per customer); foreign key to the order; a 132-character
 *                   base64 payload of three SHA-256 digests, JSON details. This is the bulk
 *                   of the bytes, and base64 of a digest is close to incompressible.
 *
 * Tables are loaded first and the indexes and foreign keys are added afterwards,
 * the way a bulk load is done. None of this is timed.
 */

export const DATASET_TABLES = ['perf_customers', 'perf_orders', 'perf_events'] as const;
export type DatasetTable = (typeof DATASET_TABLES)[number];

const ORDERS_PER_CUSTOMER = 4;
const EVENTS_PER_ORDER = 4;

/**
 * Customers per dataset. Both engines load the same rows, so a row count means
 * the same thing on either. The figures were calibrated against the real servers
 * so that tables plus indexes land near `TARGET_MIB` on both: about 6.6 MiB per
 * 1000 customers on PostgreSQL and 6.2 on MySQL (see docs/en/e2e-testing.md for
 * the sizes a run actually reports).
 */
const CUSTOMERS: Record<SizeName, number> = {
  small: 1_500,
  medium: 15_000,
  large: 75_000,
  xlarge: 155_000,
};

export interface DatasetPlan {
  size: SizeName;
  customers: number;
  orders: number;
  events: number;
}

export function planFor(size: SizeName): DatasetPlan {
  const customers = CUSTOMERS[size];
  const orders = customers * ORDERS_PER_CUSTOMER;
  return { size, customers, orders, events: orders * EVENTS_PER_ORDER };
}

export const rowsOf = (plan: DatasetPlan): Record<DatasetTable, number> => ({
  perf_customers: plan.customers,
  perf_orders: plan.orders,
  perf_events: plan.events,
});

export interface DatasetInfo extends DatasetPlan {
  dbType: DbType;
  database: string;
  /** Target size of the dataset in MiB, the name's promise. */
  targetMiB: number;
  /** Exact `count(*)` of each table after the load. */
  rows: Record<DatasetTable, number>;
  /** Tables plus indexes as the server reports them: the "source size" of the throughput figures. */
  sourceBytes: number;
  dataBytes: number;
  indexBytes: number;
  /** `pg_database_size`, which also counts the catalogs; PostgreSQL only. */
  databaseBytes: number | null;
  /** How long generating the dataset took, for the log; not part of any measurement. */
  seedMs: number;
}

type Sizes = Pick<DatasetInfo, 'dataBytes' | 'indexBytes' | 'databaseBytes'>;

/** `[from, to]` id ranges (inclusive, starting at 1) of at most `chunk` rows. */
export function idRanges(total: number, chunk: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (let from = 1; from <= total; from += chunk) {
    ranges.push([from, Math.min(from + chunk - 1, total)]);
  }
  return ranges;
}

// ── PostgreSQL ──────────────────────────────────────────────────

const PG_CHUNK = 400_000;

// Base64 of a SHA-256 digest of `<id>:<salt>`: 44 characters that look random.
const pgDigest = (id: string, salt: string): string =>
  `encode(sha256(convert_to(${id}::text || ':${salt}', 'UTF8')), 'base64')`;

const PG_SCHEMA = [
  `CREATE TABLE perf_customers (
     id integer PRIMARY KEY,
     external_id uuid NOT NULL,
     full_name text NOT NULL,
     email text NOT NULL,
     country char(2) NOT NULL,
     balance numeric(14,2) NOT NULL,
     created_at timestamp NOT NULL,
     profile jsonb NOT NULL)`,
  `CREATE TABLE perf_orders (
     id integer PRIMARY KEY,
     customer_id integer NOT NULL,
     reference uuid NOT NULL,
     status text NOT NULL,
     total numeric(12,2) NOT NULL,
     placed_at timestamp NOT NULL,
     attributes jsonb NOT NULL,
     note text NOT NULL)`,
  `CREATE TABLE perf_events (
     id bigint PRIMARY KEY,
     order_id integer NOT NULL,
     kind text NOT NULL,
     occurred_at timestamp NOT NULL,
     quantity integer NOT NULL,
     payload text NOT NULL,
     details jsonb NOT NULL)`,
];

// $1..$2 is the id range; $3 is how many parents the foreign key spreads over.
const PG_INSERTS: Record<DatasetTable, string> = {
  perf_customers: `
    INSERT INTO perf_customers
    SELECT g,
           md5('customer:' || g)::uuid,
           'Customer ' || lpad(g::text, 8, '0') || ' ' || substr(md5('name:' || g), 1, 12),
           'user' || g || '@' || (ARRAY['example.com', 'mail.test', 'corp.invalid'])[1 + g % 3],
           (ARRAY['ES', 'MX', 'AR', 'CO', 'US', 'DE', 'FR', 'JP'])[1 + g % 8],
           ((g::bigint * 7919) % 1000000) / 100.0,
           timestamp '2020-01-01' + ((g::bigint * 37) % 126144000) * interval '1 second',
           jsonb_build_object('tier', (ARRAY['free', 'plus', 'pro', 'enterprise'])[1 + g % 4],
                              'score', (g * 31) % 1000,
                              'bio', ${pgDigest('g', 'bio')})
    FROM generate_series($1::int, $2::int) AS g`,
  perf_orders: `
    INSERT INTO perf_orders
    SELECT g,
           1 + (g - 1) % $3::int,
           md5('order:' || g)::uuid,
           (ARRAY['pending', 'paid', 'shipped', 'delivered', 'cancelled'])[1 + g % 5],
           ((g::bigint * 104729) % 5000000) / 100.0,
           timestamp '2021-01-01' + ((g::bigint * 53) % 94608000) * interval '1 second',
           jsonb_build_object('channel', (ARRAY['web', 'mobile', 'store'])[1 + g % 3],
                              'items', 1 + g % 9,
                              'coupon', substr(md5('coupon:' || g), 1, 10)),
           ${pgDigest('g', 'note1')} || ${pgDigest('g', 'note2')}
    FROM generate_series($1::int, $2::int) AS g`,
  perf_events: `
    INSERT INTO perf_events
    SELECT g,
           1 + (g - 1) % $3::int,
           (ARRAY['created', 'paid', 'packed', 'shipped', 'delivered', 'refunded'])[1 + g % 6],
           timestamp '2021-01-01' + ((g * 29) % 94608000) * interval '1 second',
           1 + g % 9,
           ${pgDigest('g', 'a')} || ${pgDigest('g', 'b')} || ${pgDigest('g', 'c')},
           jsonb_build_object('seq', g, 'hash', md5('event:' || g),
                              'flags', jsonb_build_array(g % 2 = 0, g % 3 = 0))
    FROM generate_series($1::bigint, $2::bigint) AS g`,
};

const PG_INDEXES = [
  'CREATE UNIQUE INDEX perf_customers_email_idx ON perf_customers (email)',
  'CREATE INDEX perf_orders_customer_idx ON perf_orders (customer_id)',
  'CREATE INDEX perf_orders_placed_at_idx ON perf_orders (placed_at)',
  'CREATE INDEX perf_events_order_idx ON perf_events (order_id)',
  'ALTER TABLE perf_orders ADD CONSTRAINT perf_orders_customer_fk FOREIGN KEY (customer_id) REFERENCES perf_customers (id)',
  'ALTER TABLE perf_events ADD CONSTRAINT perf_events_order_fk FOREIGN KEY (order_id) REFERENCES perf_orders (id)',
];

async function seedPostgres(client: Client, plan: DatasetPlan): Promise<void> {
  for (const ddl of PG_SCHEMA) {
    await client.query(ddl);
  }
  // The customers have no parent, so their statement takes no third parameter.
  const parents: Record<DatasetTable, number | null> = {
    perf_customers: null,
    perf_orders: plan.customers,
    perf_events: plan.orders,
  };
  const rows = rowsOf(plan);
  for (const table of DATASET_TABLES) {
    const parent = parents[table];
    for (const [from, to] of idRanges(rows[table], PG_CHUNK)) {
      await client.query(PG_INSERTS[table], parent === null ? [from, to] : [from, to, parent]);
    }
  }
  for (const ddl of PG_INDEXES) {
    await client.query(ddl);
  }
  // Sets the hint bits and refreshes the statistics, so that the first dump of
  // the dataset does not pay for the load. The warm-up run absorbs the rest.
  await client.query('VACUUM (ANALYZE)');
}

async function sizesPostgres(client: Client): Promise<Sizes> {
  const { rows } = await client.query<{ data: string; indexes: string; database: string }>(
    `SELECT coalesce(sum(pg_table_size(c.oid)), 0)::bigint AS data,
            coalesce(sum(pg_indexes_size(c.oid)), 0)::bigint AS indexes,
            pg_database_size(current_database())::bigint AS database
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  return {
    dataBytes: Number(rows[0].data),
    indexBytes: Number(rows[0].indexes),
    databaseBytes: Number(rows[0].database),
  };
}

// ── MySQL ───────────────────────────────────────────────────────

const MYSQL_CHUNK = 200_000;

const myDigest = (id: string, salt: string): string =>
  `TO_BASE64(UNHEX(SHA2(CONCAT(${id}, ':${salt}'), 256)))`;

// The number table the inserts select from: `perf_seq`, dropped when the load is done.
const MYSQL_SCHEMA = [
  `CREATE TABLE perf_customers (
     id INT NOT NULL PRIMARY KEY,
     external_id CHAR(36) NOT NULL,
     full_name VARCHAR(100) NOT NULL,
     email VARCHAR(100) NOT NULL,
     country CHAR(2) NOT NULL,
     balance DECIMAL(14,2) NOT NULL,
     created_at DATETIME NOT NULL,
     profile JSON NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE perf_orders (
     id INT NOT NULL PRIMARY KEY,
     customer_id INT NOT NULL,
     reference CHAR(36) NOT NULL,
     status VARCHAR(20) NOT NULL,
     total DECIMAL(12,2) NOT NULL,
     placed_at DATETIME NOT NULL,
     attributes JSON NOT NULL,
     note VARCHAR(255) NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE perf_events (
     id BIGINT NOT NULL PRIMARY KEY,
     order_id INT NOT NULL,
     kind VARCHAR(20) NOT NULL,
     occurred_at DATETIME NOT NULL,
     quantity INT NOT NULL,
     payload VARCHAR(255) NOT NULL,
     details JSON NOT NULL) ENGINE=InnoDB`,
  'CREATE TABLE perf_seq (n INT NOT NULL PRIMARY KEY) ENGINE=InnoDB',
];

const myUuid = (hash: string): string =>
  `CONCAT_WS('-', SUBSTR(${hash}, 1, 8), SUBSTR(${hash}, 9, 4), SUBSTR(${hash}, 13, 4), SUBSTR(${hash}, 17, 4), SUBSTR(${hash}, 21, 12))`;

// The first two `?` are the id range; the third, when present, is the parent count.
const MYSQL_INSERTS: Record<DatasetTable, string> = {
  perf_customers: `
    INSERT INTO perf_customers
    SELECT n,
           ${myUuid("MD5(CONCAT('customer:', n))")},
           CONCAT('Customer ', LPAD(n, 8, '0'), ' ', SUBSTR(MD5(CONCAT('name:', n)), 1, 12)),
           CONCAT('user', n, '@', ELT(1 + n % 3, 'example.com', 'mail.test', 'corp.invalid')),
           ELT(1 + n % 8, 'ES', 'MX', 'AR', 'CO', 'US', 'DE', 'FR', 'JP'),
           ((n * 7919) % 1000000) / 100,
           TIMESTAMPADD(SECOND, (n * 37) % 126144000, '2020-01-01 00:00:00'),
           JSON_OBJECT('tier', ELT(1 + n % 4, 'free', 'plus', 'pro', 'enterprise'),
                       'score', (n * 31) % 1000,
                       'bio', ${myDigest('n', 'bio')})
    FROM perf_seq WHERE n BETWEEN ? AND ?`,
  perf_orders: `
    INSERT INTO perf_orders
    SELECT n,
           1 + (n - 1) % ?,
           ${myUuid("MD5(CONCAT('order:', n))")},
           ELT(1 + n % 5, 'pending', 'paid', 'shipped', 'delivered', 'cancelled'),
           ((n * 104729) % 5000000) / 100,
           TIMESTAMPADD(SECOND, (n * 53) % 94608000, '2021-01-01 00:00:00'),
           JSON_OBJECT('channel', ELT(1 + n % 3, 'web', 'mobile', 'store'),
                       'items', 1 + n % 9,
                       'coupon', SUBSTR(MD5(CONCAT('coupon:', n)), 1, 10)),
           CONCAT(${myDigest('n', 'note1')}, ${myDigest('n', 'note2')})
    FROM perf_seq WHERE n BETWEEN ? AND ?`,
  perf_events: `
    INSERT INTO perf_events
    SELECT n,
           1 + (n - 1) % ?,
           ELT(1 + n % 6, 'created', 'paid', 'packed', 'shipped', 'delivered', 'refunded'),
           TIMESTAMPADD(SECOND, (n * 29) % 94608000, '2021-01-01 00:00:00'),
           1 + n % 9,
           CONCAT(${myDigest('n', 'a')}, ${myDigest('n', 'b')}, ${myDigest('n', 'c')}),
           JSON_OBJECT('seq', n, 'hash', MD5(CONCAT('event:', n)),
                       'flags', JSON_ARRAY(n % 2 = 0, n % 3 = 0))
    FROM perf_seq WHERE n BETWEEN ? AND ?`,
};

const MYSQL_INDEXES = [
  'CREATE UNIQUE INDEX perf_customers_email_idx ON perf_customers (email)',
  'CREATE INDEX perf_orders_placed_at_idx ON perf_orders (placed_at)',
  // Each foreign key builds the index on its column.
  'ALTER TABLE perf_orders ADD CONSTRAINT perf_orders_customer_fk FOREIGN KEY (customer_id) REFERENCES perf_customers (id)',
  'ALTER TABLE perf_events ADD CONSTRAINT perf_events_order_fk FOREIGN KEY (order_id) REFERENCES perf_orders (id)',
];

/** Fills `perf_seq` with 1..total by doubling it: log2(total) statements instead of one per row. */
async function fillNumberTable(connection: Connection, total: number): Promise<void> {
  await connection.query('INSERT INTO perf_seq VALUES (1)');
  let filled = 1;
  while (filled < total) {
    const step = Math.min(filled, total - filled);
    await connection.query('INSERT INTO perf_seq SELECT n + ? FROM perf_seq WHERE n <= ?', [filled, step]);
    filled += step;
  }
}

async function seedMysql(connection: Connection, plan: DatasetPlan): Promise<void> {
  for (const ddl of MYSQL_SCHEMA) {
    await connection.query(ddl);
  }
  await fillNumberTable(connection, plan.events);

  const rows = rowsOf(plan);
  const parents: Record<DatasetTable, number | null> = {
    perf_customers: null,
    perf_orders: plan.customers,
    perf_events: plan.orders,
  };
  for (const table of DATASET_TABLES) {
    const parent = parents[table];
    for (const [from, to] of idRanges(rows[table], MYSQL_CHUNK)) {
      await connection.query(MYSQL_INSERTS[table], parent === null ? [from, to] : [parent, from, to]);
    }
  }
  await connection.query('DROP TABLE perf_seq');

  // The rows are consistent by construction, so the foreign keys are added
  // without re-checking them row by row (which would force a table copy).
  await connection.query('SET SESSION foreign_key_checks = 0');
  for (const ddl of MYSQL_INDEXES) {
    await connection.query(ddl);
  }
  await connection.query('SET SESSION foreign_key_checks = 1');
  await connection.query(`ANALYZE TABLE ${DATASET_TABLES.join(', ')}`);
}

async function sizesMysql(connection: Connection, database: string): Promise<Sizes> {
  // Without this, information_schema serves statistics cached for up to a day.
  await connection.query('SET SESSION information_schema_stats_expiry = 0');
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT SUM(DATA_LENGTH) AS data, SUM(INDEX_LENGTH) AS indexes FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [database],
  );
  return { dataBytes: Number(rows[0].data), indexBytes: Number(rows[0].indexes), databaseBytes: null };
}

// ── Both engines ────────────────────────────────────────────────

/** Exact row count of every dataset table of a database (a restore target, say). */
export async function countRows(dbType: DbType, database: string): Promise<Record<DatasetTable, number>> {
  const counts = {} as Record<DatasetTable, number>;
  if (dbType === 'postgres') {
    await withPostgres(database, async (client) => {
      for (const table of DATASET_TABLES) {
        const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
        counts[table] = Number(rows[0].n);
      }
    });
  } else {
    await withMysql(database, async (connection) => {
      for (const table of DATASET_TABLES) {
        const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`);
        counts[table] = Number(rows[0].n);
      }
    });
  }
  return counts;
}

/**
 * Generates a dataset in an existing, empty database and reports what it holds.
 * Fails when the row counts are not the plan's, which would mean the generator
 * is wrong and every throughput figure with it.
 */
export async function seedPlan(dbType: DbType, database: string, plan: DatasetPlan): Promise<DatasetInfo> {
  const started = performance.now();

  const sizes =
    dbType === 'postgres'
      ? await withPostgres(database, async (client) => {
          await seedPostgres(client, plan);
          return sizesPostgres(client);
        })
      : await withMysql(database, async (connection) => {
          await seedMysql(connection, plan);
          return sizesMysql(connection, database);
        });

  const rows = await countRows(dbType, database);
  const expected = rowsOf(plan);
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    throw new Error(
      `The generated ${dbType} dataset has the wrong row counts: expected ${JSON.stringify(expected)}, found ${JSON.stringify(rows)}.`,
    );
  }

  return {
    ...plan,
    dbType,
    database,
    targetMiB: TARGET_MIB[plan.size],
    rows,
    sourceBytes: sizes.dataBytes + sizes.indexBytes,
    ...sizes,
    seedMs: Math.round(performance.now() - started),
  };
}

export const seedDataset = (dbType: DbType, database: string, size: SizeName): Promise<DatasetInfo> =>
  seedPlan(dbType, database, planFor(size));
