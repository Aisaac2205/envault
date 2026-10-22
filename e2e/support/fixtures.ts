import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { assertOk, newApiContext, signInOnDirectApi } from './api';
import { AUTH_STATE_FILE } from './auth-state';
import { routeAuthToOwnRateLimitBucket } from './browser';
import { POSTGRES_SOURCE, type SourceDatabase } from './sources';
import { uniqueEmail, uniqueId, uniqueName } from './unique';

export interface ConnectionInput extends SourceDatabase {
  name: string;
  environment: 'prod' | 'dev' | 'qa';
}

/** What the API returns for a connection: never the password. */
export interface Connection {
  id: string;
  name: string;
  slug: string;
  environment: ConnectionInput['environment'];
  dbType: ConnectionInput['dbType'];
  host: string;
  port: number;
  database: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedConnection {
  input: ConnectionInput;
  connection: Connection;
  response: APIResponse;
}

interface ApiFixtures {
  /** A client with no cookies at all. */
  anonymous: APIRequestContext;
  /**
   * A client signed in as the admin, with the base URL under `/api`. The
   * built-in `request` fixture is not used for this because its base URL is
   * the project's: the web root in `ui-chromium`, where `connections` would
   * resolve to a page of the app instead of the API.
   */
  adminApi: APIRequestContext;
  /**
   * Creates a connection (a `dev` Postgres source with a unique name unless
   * overridden) and deletes it when the test ends, even if the test failed.
   */
  createConnection: (overrides?: Partial<ConnectionInput>) => Promise<CreatedConnection>;
  /** Looks a connection up by name through the API; `undefined` when there is none. */
  findConnection: (name: string) => Promise<Connection | undefined>;
  /**
   * Registers a connection name to be deleted when the test ends. For the
   * connections that the UI creates, which `createConnection` never sees: it
   * deletes by name, so it also cleans up when the test fails before reading
   * the new connection's id.
   */
  deleteConnectionAfterTest: (name: string) => void;
}

interface ApiWorkerFixtures {
  /**
   * A client signed in as a user whose role is `user`, for checking what the
   * admin guard keeps out. Created once per worker through the Better Auth
   * admin plugin and removed when the worker ends.
   */
  nonAdmin: APIRequestContext;
}

export const test = base.extend<ApiFixtures, ApiWorkerFixtures>({
  // The browser context of every UI spec keeps its auth calls out of the rate
  // limit bucket that the whole run shares (see support/browser.ts).
  context: async ({ context }, use) => {
    await routeAuthToOwnRateLimitBucket(context);
    await use(context);
  },

  anonymous: async ({ playwright }, use) => {
    const context = await newApiContext(playwright);
    await use(context);
    await context.dispose();
  },

  adminApi: async ({ playwright }, use) => {
    const context = await newApiContext(playwright, AUTH_STATE_FILE);
    await use(context);
    await context.dispose();
  },

  createConnection: async ({ adminApi }, use) => {
    const createdIds: string[] = [];

    await use(async (overrides = {}) => {
      const input: ConnectionInput = {
        ...POSTGRES_SOURCE,
        name: uniqueName('conn'),
        environment: 'dev',
        ...overrides,
      };
      const response = await adminApi.post('connections', { data: input });
      await assertOk(response, `Creating connection "${input.name}"`);

      const { data: connection } = await response.json();
      createdIds.push(connection.id);
      return { input, connection, response };
    });

    // A test may delete its connection itself, so a 404 here is fine; anything
    // else means a connection was left behind and the test must say so.
    for (const id of createdIds.reverse()) {
      const response = await adminApi.delete(`connections/${id}`);
      if (response.status() !== 404) {
        await assertOk(response, `Cleaning up connection ${id}`);
      }
    }
  },

  findConnection: async ({ adminApi }, use) => {
    await use(async (name) => {
      const response = await adminApi.get('connections');
      await assertOk(response, 'Listing connections');
      const { data }: { data: Connection[] } = await response.json();
      return data.find((connection) => connection.name === name);
    });
  },

  deleteConnectionAfterTest: async ({ adminApi }, use) => {
    const names = new Set<string>();

    await use((name) => {
      names.add(name);
    });

    if (names.size === 0) {
      return;
    }
    const listed = await adminApi.get('connections');
    await assertOk(listed, 'Listing connections to clean up');
    const { data }: { data: Connection[] } = await listed.json();

    // Every delete is attempted before reporting, so one failure cannot hide
    // the connections that come after it.
    const failures: string[] = [];
    for (const connection of data.filter(({ name }) => names.has(name))) {
      const response = await adminApi.delete(`connections/${connection.id}`);
      if (!response.ok()) {
        failures.push(`${connection.name} (HTTP ${response.status()})`);
      }
    }
    expect(failures, 'Connections left behind by the test').toEqual([]);
  },

  nonAdmin: [
    async ({ playwright }, use) => {
      const admin = await newApiContext(playwright, AUTH_STATE_FILE);
      const credentials = { email: uniqueEmail('user'), password: `Pw-${uniqueId()}-e2e` };

      const created = await admin.post('auth/admin/create-user', {
        data: { ...credentials, name: 'E2E non-admin', role: 'user' },
      });
      await assertOk(created, 'Creating the non-admin user');
      const { user } = await created.json();
      expect(user.role).toBe('user');

      const context = await newApiContext(playwright);
      try {
        await assertOk(
          await signInOnDirectApi(context, credentials),
          'Signing in as the non-admin user',
        );
        await use(context);
      } finally {
        await context.dispose();
        const removed = await admin.post('auth/admin/remove-user', { data: { userId: user.id } });
        await admin.dispose();
        await assertOk(removed, `Removing the non-admin user ${credentials.email}`);
      }
    },
    { scope: 'worker' },
  ],
});

export { expect };
