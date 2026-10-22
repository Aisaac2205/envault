export interface SourceDatabase {
  dbType: 'postgres' | 'mysql';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

// The two source databases that docker-compose.e2e.yml starts next to the app.
// The API reaches them on the compose network, so these are the in-network
// host names and ports, not the ports published to the host (5435 and 3307).

export const POSTGRES_SOURCE: SourceDatabase = {
  dbType: 'postgres',
  host: 'db-test-pg',
  port: 5432,
  database: 'testdb',
  username: 'test_user',
  password: 'test_pass123',
};

export const MYSQL_SOURCE: SourceDatabase = {
  dbType: 'mysql',
  host: 'db-test-mysql',
  port: 3306,
  database: 'testdb',
  username: 'test_user',
  password: 'test_pass123',
};

// `test_user` only owns `testdb` on MySQL. The pipeline specs work on databases
// of their own, and a MySQL restore creates and swaps staging databases, so
// they connect as `root` (MYSQL_ROOT_PASSWORD of the compose file). The
// Postgres `test_user` is already the server's superuser.
export const MYSQL_ADMIN: SourceDatabase = {
  ...MYSQL_SOURCE,
  username: 'root',
  password: 'root_pass123',
};
