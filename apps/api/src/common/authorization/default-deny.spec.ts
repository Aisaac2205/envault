import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { auth } from '../../auth/auth.config';
import { AuthenticatedOnly } from './authenticated-only.decorator';
import { GLOBAL_AUTHORIZATION_GUARDS } from './global-guards';
import { Public } from './public.decorator';
import { RequirePermission } from './require-permission.decorator';

// Runtime proof of default-deny. A tiny Nest app is bootstrapped with the same
// global guards AppModule registers, and with controllers written the way a
// careless developer would write them. Better Auth itself is replaced (it is
// ESM-only and needs a database); everything else is the real thing.
jest.mock('../../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
  authPool: {},
}));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: () => new Headers(),
}));

@Controller('probe-undecorated')
class UndecoratedController {
  @Get()
  read() {
    return 'reached';
  }
}

@Controller('probe-feature')
@RequirePermission('audit')
class FeatureController {
  @Get()
  read() {
    return 'reached';
  }
}

@Controller('probe-session-only')
@AuthenticatedOnly()
class SessionOnlyController {
  @Get()
  read() {
    return 'reached';
  }
}

@Controller('probe-public')
@Public()
class PublicController {
  @Get()
  read() {
    return 'reached';
  }
}

const getSession = auth.api.getSession as unknown as jest.Mock;

function signedInAs(role: string | null): void {
  getSession.mockResolvedValue(
    role ? { user: { id: 'u1', email: 'u@x.test', name: 'U', role } } : null,
  );
}

describe('global guards: default-deny at runtime', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UndecoratedController, FeatureController, SessionOnlyController, PublicController],
      providers: [...GLOBAL_AUTHORIZATION_GUARDS],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getSession.mockReset();
  });

  const status = async (path: string) => (await fetch(`${baseUrl}/${path}`)).status;

  it('registers the session guard before the permissions guard', () => {
    expect(GLOBAL_AUTHORIZATION_GUARDS.map((provider) => 'useClass' in provider && provider.useClass.name)).toEqual([
      'BetterAuthGuard',
      'PermissionsGuard',
    ]);
  });

  describe('a controller nobody decorated', () => {
    it('answers 401 without a session', async () => {
      signedInAs(null);

      expect(await status('probe-undecorated')).toBe(401);
    });

    it.each(['admin', 'user'])('answers 403 to a signed-in %s', async (role) => {
      signedInAs(role);

      expect(await status('probe-undecorated')).toBe(403);
    });
  });

  describe('a controller with a feature', () => {
    it('answers 401 without a session', async () => {
      signedInAs(null);

      expect(await status('probe-feature')).toBe(401);
    });

    it('answers 403 to a role the map does not grant it to', async () => {
      signedInAs('user');

      expect(await status('probe-feature')).toBe(403);
    });

    it('answers 200 to a role the map grants it to', async () => {
      signedInAs('admin');

      expect(await status('probe-feature')).toBe(200);
    });

    it('answers 200 when any role of a comma-separated list is granted', async () => {
      signedInAs('user,admin');

      expect(await status('probe-feature')).toBe(200);
    });
  });

  describe('a session-only controller', () => {
    it('answers 401 without a session', async () => {
      signedInAs(null);

      expect(await status('probe-session-only')).toBe(401);
    });

    it.each(['admin', 'user', 'viewer'])('answers 200 to a signed-in %s', async (role) => {
      signedInAs(role);

      expect(await status('probe-session-only')).toBe(200);
    });
  });

  describe('a public controller', () => {
    it('answers 200 without a session, and never asks for one', async () => {
      signedInAs(null);

      expect(await status('probe-public')).toBe(200);
      expect(getSession).not.toHaveBeenCalled();
    });
  });
});
