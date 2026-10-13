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
