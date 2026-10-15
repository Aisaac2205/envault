import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test, type Connection, type ConnectionInput } from '../../support/fixtures';
import { MYSQL_SOURCE, POSTGRES_SOURCE, type SourceDatabase } from '../../support/sources';
import { uniqueId, uniqueName } from '../../support/unique';

// Connections hold the credentials of the databases Envault backs up, so
// besides CRUD the contract that matters most is that a response never carries
// the password, neither as typed nor in the encrypted form it is stored in
// (iv:authTag:ciphertext, all hex).
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const ENCRYPTED_SECRET = /[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+/i;

function expectNoSecret(body: unknown, password: string): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(password);
  expect(text).not.toMatch(/"(password|secret|encrypted\w*)"\s*:/i);
  expect(text).not.toMatch(ENCRYPTED_SECRET);
}

test.describe('create', () => {
  test('creates a connection and generates its slug from the name', async ({ createConnection }) => {
    const id = uniqueId();
    const { input, connection, response } = await createConnection({
      name: `E2E Slug ${id}`,
      environment: 'qa',
    });

    expect(response.status()).toBe(201);
    expect(connection).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: input.name,
      slug: `e2e-slug-${id}`,
      environment: 'qa',
      dbType: 'postgres',
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  test('defaults dbType to postgres when it is omitted', async ({ createConnection }) => {
    // undefined is dropped when the body is serialised, so the field is not sent.
    const { connection } = await createConnection({ dbType: undefined });

    expect(connection.dbType).toBe('postgres');
  });

  test('stores a MySQL connection as MySQL', async ({ createConnection }) => {
    const { connection } = await createConnection({ ...MYSQL_SOURCE });

    expect(connection).toMatchObject({ dbType: 'mysql', host: 'db-test-mysql', port: 3306 });
  });

  test('gives two connections with the same name different slugs', async ({ createConnection }) => {
    const name = uniqueName('twin');
    const first = await createConnection({ name });
    const second = await createConnection({ name });

    expect(first.connection.slug).toBe(name);
    expect(second.connection.slug).not.toBe(first.connection.slug);
    expect(second.connection.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test('never returns the password, as typed or encrypted', async ({ request, createConnection }) => {
    const password = `leak-probe-${uniqueId()}`;
    const { connection, response } = await createConnection({ password });

    expectNoSecret(await response.json(), password);
    expectNoSecret(
      await (await request.get(`connections/${connection.id}`)).json(),
      password,
    );
    expectNoSecret(await (await request.get('connections')).json(), password);
  });
});

test.describe('validation', () => {
  const invalid: [string, (valid: ConnectionInput) => object][] = [
    ['an empty body', () => ({})],
    ['a missing name', (valid) => ({ ...valid, name: undefined })],
    ['an empty name', (valid) => ({ ...valid, name: '' })],
    ['a name over 100 characters', (valid) => ({ ...valid, name: 'x'.repeat(101) })],
    ['a missing environment', (valid) => ({ ...valid, environment: undefined })],
    ['an unknown environment', (valid) => ({ ...valid, environment: 'staging' })],
    ['an unknown dbType', (valid) => ({ ...valid, dbType: 'oracle' })],
    ['port 0', (valid) => ({ ...valid, port: 0 })],
    ['a port above 65535', (valid) => ({ ...valid, port: 65536 })],
    ['a non-numeric port', (valid) => ({ ...valid, port: 'abc' })],
    ['a fractional port', (valid) => ({ ...valid, port: 5432.5 })],
    ['a missing password', (valid) => ({ ...valid, password: undefined })],
    ['an unexpected property', (valid) => ({ ...valid, isActive: false })],
  ];

  for (const [title, build] of invalid) {
    test(`rejects ${title} with 400`, async ({ request }) => {
      const valid: ConnectionInput = { ...POSTGRES_SOURCE, name: uniqueName('invalid'), environment: 'dev' };

      await expectErrorEnvelope(await request.post('connections', { data: build(valid) }), 400);
    });
  }
});

test.describe('read', () => {
  test('returns one connection by id', async ({ request, createConnection }) => {
    const { connection } = await createConnection();

    const found = await expectSuccessEnvelope<Connection>(
      await request.get(`connections/${connection.id}`),
    );
    expect(found).toEqual(connection);
  });

  test('lists connections and filters them by environment', async ({ request, createConnection }) => {
    const { connection } = await createConnection({ environment: 'dev' });
    const ids = async (query: string) =>
      (await expectSuccessEnvelope<Connection[]>(await request.get(`connections${query}`))).map(
        (item) => item.id,
      );

    expect(await ids('')).toContain(connection.id);
    expect(await ids('?environment=dev')).toContain(connection.id);
    expect(await ids('?environment=qa')).not.toContain(connection.id);
  });

  test('rejects an unknown environment filter with 400', async ({ request }) => {
    await expectErrorEnvelope(await request.get('connections?environment=staging'), 400);
  });
});

test.describe('update', () => {
  test('changes the fields it is given and keeps the slug', async ({ request, createConnection }) => {
    const { connection } = await createConnection();
    const name = uniqueName('renamed');

    const response = await request.patch(`connections/${connection.id}`, {
      data: { name, port: 5433 },
    });
    const updated = await expectSuccessEnvelope<Connection>(response);

    expect(updated).toMatchObject({ id: connection.id, name, port: 5433, host: connection.host });
    // The slug prefixes every backup key in storage, so a rename must not move it.
    expect(updated.slug).toBe(connection.slug);
    const reread = await expectSuccessEnvelope<Connection>(
      await request.get(`connections/${connection.id}`),
    );
    expect(reread).toMatchObject({ name, port: 5433 });
  });

  // Regression guard for D15 (fixed): the update DTO inherited the create DTO's
  // `dbType = postgres` initializer, so a request that did not name the engine
  // turned a MySQL connection into a PostgreSQL one, in the response and in the
  // database.
  test('keeps the engine when a connection is renamed', async ({ request, createConnection }) => {
    const { connection } = await createConnection({ ...MYSQL_SOURCE });
    const name = uniqueName('renamed');

    const updated = await expectSuccessEnvelope<Connection>(
      await request.patch(`connections/${connection.id}`, { data: { name } }),
    );

    expect(updated).toMatchObject({ id: connection.id, name, dbType: 'mysql' });
    const reread = await expectSuccessEnvelope<Connection>(
      await request.get(`connections/${connection.id}`),
    );
    expect(reread).toMatchObject({ name, dbType: 'mysql', host: MYSQL_SOURCE.host, port: MYSQL_SOURCE.port });
  });

  test('changes the engine when the update names it', async ({ request, createConnection }) => {
    const { connection } = await createConnection();
    expect(connection.dbType).toBe('postgres');

    const updated = await expectSuccessEnvelope<Connection>(
      await request.patch(`connections/${connection.id}`, {
        data: { dbType: 'mysql', host: MYSQL_SOURCE.host, port: MYSQL_SOURCE.port },
      }),
    );

    expect(updated).toMatchObject({ id: connection.id, dbType: 'mysql' });
    const reread = await expectSuccessEnvelope<Connection>(
      await request.get(`connections/${connection.id}`),
    );
    expect(reread).toMatchObject({ dbType: 'mysql', host: MYSQL_SOURCE.host, port: MYSQL_SOURCE.port });
    // The stored engine is the one used: the MySQL source accepts the stored credentials.
    const tested = await expectSuccessEnvelope<{ success: boolean }>(
      await request.post(`connections/${connection.id}/test`),
      201,
    );
    expect(tested.success).toBe(true);
  });

  test('applies a new password to later connection tests', async ({ request, createConnection }) => {
    const { connection } = await createConnection();
    const connects = async () =>
      (
        await expectSuccessEnvelope<{ success: boolean }>(
          await request.post(`connections/${connection.id}/test`),
          201,
        )
      ).success;
    const changePassword = (password: string) =>
      request.patch(`connections/${connection.id}`, { data: { password } });

    expect(await connects()).toBe(true);
    await changePassword('changed-wrong-password');
    expect(await connects()).toBe(false);
    await changePassword(POSTGRES_SOURCE.password);
    expect(await connects()).toBe(true);
  });

  // Regression guard for D6 (fixed): the update path returned the decrypted
  // password in the body (`"password":"test_pass123"`), unlike create, read and
  // list. The repository saved a plain object, so the entity's @Exclude() on
  // `password` never applied; it now keeps the entity instance.
  test('does not return the password in the update response', async ({ request, createConnection }) => {
    const password = `leak-probe-${uniqueId()}`;
    const { connection } = await createConnection({ password });

    const response = await request.patch(`connections/${connection.id}`, {
      data: { name: uniqueName('renamed') },
    });

    expect(response.status()).toBe(200);
    expectNoSecret(await response.json(), password);
  });

  test('rejects an out-of-range port with 400', async ({ request, createConnection }) => {
    const { connection } = await createConnection();

    await expectErrorEnvelope(
      await request.patch(`connections/${connection.id}`, { data: { port: 65536 } }),
      400,
    );
  });

  // Regression guard for D18: the update DTO marked every field optional with
  // `@IsOptional()`, which lets `null` skip validation as well, so a `null` for
  // a required field reached the database and came back as a 500.
  for (const field of ['name', 'environment', 'dbType', 'host', 'port', 'database', 'username', 'password']) {
    test(`rejects a null ${field} with 400 and keeps the connection`, async ({ request, createConnection }) => {
      const { connection } = await createConnection({ ...MYSQL_SOURCE });

      await expectErrorEnvelope(
        await request.patch(`connections/${connection.id}`, { data: { [field]: null } }),
        400,
      );

      const reread = await expectSuccessEnvelope<Connection>(
        await request.get(`connections/${connection.id}`),
      );
      expect(reread).toEqual(connection);
    });
  }

  test('answers 404 for an unknown id', async ({ request }) => {
    await expectErrorEnvelope(
      await request.patch(`connections/${UNKNOWN_ID}`, { data: { name: uniqueName('ghost') } }),
      404,
    );
  });
});

test.describe('delete', () => {
  test('removes the connection from every read', async ({ request, createConnection }) => {
    const { connection } = await createConnection();

    const removed = await request.delete(`connections/${connection.id}`);
    expect(removed.status()).toBe(200);

    await expectErrorEnvelope(await request.get(`connections/${connection.id}`), 404);
    const remaining = await expectSuccessEnvelope<Connection[]>(await request.get('connections'));
    expect(remaining.map((item) => item.id)).not.toContain(connection.id);
    await expectErrorEnvelope(await request.delete(`connections/${connection.id}`), 404);
  });

  test('answers 404 for an unknown id', async ({ request }) => {
    await expectErrorEnvelope(await request.delete(`connections/${UNKNOWN_ID}`), 404);
  });
});

test.describe('POST /connections/test-raw', () => {
  const reachable: [string, SourceDatabase][] = [
    ['the PostgreSQL source', POSTGRES_SOURCE],
    ['the MySQL source', MYSQL_SOURCE],
  ];

  for (const [title, source] of reachable) {
    test(`connects to ${title}`, async ({ request }) => {
      const result = await expectSuccessEnvelope<{ success: boolean; latencyMs: number }>(
        await request.post('connections/test-raw', { data: source }),
        201,
      );

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  }

  // A failed connection is a successful test run: the API answers normally and
  // says why in the body. The answer must never echo the password it was given.
  const unreachable: [string, SourceDatabase][] = [
    ['a wrong PostgreSQL password', { ...POSTGRES_SOURCE, password: 'wrong-password' }],
    ['a wrong MySQL password', { ...MYSQL_SOURCE, password: 'wrong-password' }],
    ['an unknown PostgreSQL database', { ...POSTGRES_SOURCE, database: 'no_such_database' }],
    ['a host that does not resolve', { ...POSTGRES_SOURCE, host: 'no-such-host.invalid' }],
    ['a MySQL host that does not resolve', { ...MYSQL_SOURCE, host: 'no-such-host.invalid' }],
    ['a closed port', { ...POSTGRES_SOURCE, port: 1 }],
  ];

  for (const [title, source] of unreachable) {
    test(`reports failure for ${title}`, async ({ request }) => {
      const response = await request.post('connections/test-raw', { data: source });
      const result = await expectSuccessEnvelope<{ success: boolean; error: string }>(response, 201);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/\S/);
      expect(JSON.stringify(result)).not.toContain(source.password);
    });
  }

  const malformed: [string, object][] = [
    ['an empty body', {}],
    ['an unknown dbType', { ...POSTGRES_SOURCE, dbType: 'oracle' }],
    ['an out-of-range port', { ...POSTGRES_SOURCE, port: 70000 }],
  ];

  for (const [title, body] of malformed) {
    test(`rejects ${title} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.post('connections/test-raw', { data: body }), 400);
    });
  }
});

test.describe('POST /connections/:id/test', () => {
  const saved: [string, Partial<ConnectionInput>][] = [
    ['PostgreSQL', {}],
    ['MySQL', { ...MYSQL_SOURCE }],
  ];

  for (const [title, overrides] of saved) {
    test(`connects with a saved ${title} connection`, async ({ request, createConnection }) => {
      const { connection } = await createConnection(overrides);

      const result = await expectSuccessEnvelope<{ success: boolean }>(
        await request.post(`connections/${connection.id}/test`),
        201,
      );
      expect(result.success).toBe(true);
    });
  }

  test('reports failure for a saved connection with a wrong password', async ({ request, createConnection }) => {
    const { connection } = await createConnection({ password: 'wrong-password' });

    const result = await expectSuccessEnvelope<{ success: boolean; error: string }>(
      await request.post(`connections/${connection.id}/test`),
      201,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\S/);
  });

  test('answers 404 for an unknown id', async ({ request }) => {
    await expectErrorEnvelope(await request.post(`connections/${UNKNOWN_ID}/test`), 404);
  });
});
