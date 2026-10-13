import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { assertOk, newApiContext, signInOnDirectApi } from './api';
import { AUTH_STATE_FILE } from './auth-state';
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
   * Creates a connection (a `dev` Postgres source with a unique name unless
   * overridden) and deletes it when the test ends, even if the test failed.
   */
  createConnection: (overrides?: Partial<ConnectionInput>) => Promise<CreatedConnection>;
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
  anonymous: async ({ playwright }, use) => {
    const context = await newApiContext(playwright);
    await use(context);
    await context.dispose();
  },

  createConnection: async ({ request }, use) => {
    const createdIds: string[] = [];

    await use(async (overrides = {}) => {
      const input: ConnectionInput = {
        ...POSTGRES_SOURCE,
        name: uniqueName('conn'),
        environment: 'dev',
        ...overrides,
      };
      const response = await request.post('connections', { data: input });
      await assertOk(response, `Creating connection "${input.name}"`);

      const { data: connection } = await response.json();
      createdIds.push(connection.id);
      return { input, connection, response };
    });

    // A test may delete its connection itself, so a 404 here is fine; anything
    // else means a connection was left behind and the test must say so.
    for (const id of createdIds.reverse()) {
      const response = await request.delete(`connections/${id}`);
      if (response.status() !== 404) {
        await assertOk(response, `Cleaning up connection ${id}`);
      }
    }
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
