import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { AUTHENTICATED_ONLY_KEY } from './authenticated-only.decorator';
import { GLOBAL_AUTHORIZATION_GUARDS } from './global-guards';
import { FEATURES, isFeature } from './permissions';
import { PUBLIC_KEY } from './public.decorator';
import { PERMISSION_KEY } from './require-permission.decorator';

// Drift test for the permission map. It finds every controller in the source
// tree, reads the metadata the global guards read at request time, and fails
// when a route could be reached without the map deciding. The guards
// themselves deny by default (see default-deny.spec.ts); this test makes the
// way out of that default, `@Public()` and `@AuthenticatedOnly()`, a decision
// that has to be written down here, in review.
//
// better-auth/node is ESM-only and this repo's Jest config does not transform
// node_modules, so the two modules that import it are replaced by stand-ins.
// The controllers and the guards are loaded for real.
jest.mock('../../auth/auth.config', () => ({ auth: {}, authPool: {} }));
jest.mock('better-auth/node', () => ({
  toNodeHandler: () => () => undefined,
  fromNodeHeaders: () => ({}),
}));

type Constructor = new (...args: never[]) => object;
type Handler = (...args: never[]) => unknown;

const SRC_ROOT = join(__dirname, '..', '..');

/** Controllers that answer without a session. Adding one is a security decision. */
const PUBLIC: Record<string, string> = {
  HealthController: 'liveness probe hit by Kubernetes and Docker without a session',
  AuthController: 'Better Auth owns sign-in and its own admin routes behind this catch-all',
};

/** Controllers that need a session but no feature. Adding one is a security decision. */
const SESSION_ONLY: Record<string, string> = {
  PermissionsController: 'every signed-in user may read their own permissions',
};

/**
 * Features with no Nest controller behind them: their server-side enforcement
 * lives elsewhere, and the map entry only drives what the web app offers.
 */
const FEATURES_WITHOUT_CONTROLLER: Record<string, string> = {
  users: 'enforced by the Better Auth admin plugin (adminRoles defaults to ["admin"])',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const controllerFiles = sourceFiles(SRC_ROOT).filter((file) =>
  readFileSync(file, 'utf-8').includes('@Controller('),
);

const controllers: Constructor[] = controllerFiles.flatMap((file) =>
  Object.values(jest.requireActual<Record<string, unknown>>(file)).filter(
    (exported): exported is Constructor =>
      typeof exported === 'function' && Reflect.hasMetadata(PATH_METADATA, exported),
  ),
);

function handlersOf(controller: Constructor): [string, Handler][] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name): [string, Handler] => [
      name,
      (controller.prototype as Record<string, unknown>)[name] as Handler,
    ])
    .filter(
      ([, handler]) =>
        typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler),
    );
}

/** The metadata a guard would read: the handler's own, else the controller's. */
function declared(key: string, controller: Constructor, handler: Handler): unknown {
  return Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
}

const isPublic = (c: Constructor, h: Handler) => declared(PUBLIC_KEY, c, h) === true;
const isSessionOnly = (c: Constructor, h: Handler) =>
  declared(AUTHENTICATED_ONLY_KEY, c, h) === true;
const featureOf = (c: Constructor, h: Handler) => declared(PERMISSION_KEY, c, h);

const nameOf = (c: Constructor) => c.name;
const handlerTable = (c: Constructor) => handlersOf(c).map(([name, handler]) => [name, handler] as const);

describe('permission coverage', () => {
  it('finds the controllers it is meant to police', () => {
    // A discovery that silently finds nothing would make every other test here pass.
    expect(controllers.length).toBeGreaterThan(
      Object.keys(PUBLIC).length + Object.keys(SESSION_ONLY).length,
    );
    expect(controllers.map(nameOf)).toEqual(
      expect.arrayContaining(['AuditController', 'BackupController', 'ConnectionsController']),
    );
  });

  it('loads every class that declares @Controller (none is hidden by a missing export)', () => {
    const declaredCount = controllerFiles.reduce(
      (total, file) => total + (readFileSync(file, 'utf-8').match(/@Controller\(/g) ?? []).length,
      0,
    );

    expect(controllers).toHaveLength(declaredCount);
  });

  describe('the guards are global, in this order', () => {
    it('lists the session guard before the permissions guard', () => {
      expect(
        GLOBAL_AUTHORIZATION_GUARDS.map((provider) => {
          const { provide, useClass } = provider as { provide: unknown; useClass: { name: string } };
          return [provide, useClass.name];
        }),
      ).toEqual([
        [APP_GUARD, 'BetterAuthGuard'],
        [APP_GUARD, 'PermissionsGuard'],
      ]);
    });

    it('has AppModule register them once, after the throttler', () => {
      // AppModule cannot be imported here: its decorators validate the
      // environment at load time. Its source is checked instead.
      const source = readFileSync(join(SRC_ROOT, 'app.module.ts'), 'utf-8');
      const throttler = source.indexOf('useClass: ThrottlerGuard');
      const authorization = source.indexOf('...GLOBAL_AUTHORIZATION_GUARDS');

      expect(throttler).toBeGreaterThan(-1);
      expect(authorization).toBeGreaterThan(throttler);
      expect(source.match(/\.\.\.GLOBAL_AUTHORIZATION_GUARDS/g)).toHaveLength(1);
      expect(source.match(/provide: APP_GUARD/g)).toHaveLength(1);
    });
  });

  describe('the ways out of default-deny are an explicit, reviewed list', () => {
    it('makes public exactly the controllers listed here, every route of them', () => {
      const markedPublic = controllers
        .filter((c) => handlersOf(c).some(([, h]) => isPublic(c, h)))
        .map(nameOf)
        .sort();

      expect(markedPublic).toEqual(Object.keys(PUBLIC).sort());
      for (const controller of controllers.filter((c) => nameOf(c) in PUBLIC)) {
        for (const [, handler] of handlersOf(controller)) {
          expect(isPublic(controller, handler)).toBe(true);
        }
      }
    });

    it('makes session-only exactly the controllers listed here, every route of them', () => {
      const markedSessionOnly = controllers
        .filter((c) => handlersOf(c).some(([, h]) => isSessionOnly(c, h)))
        .map(nameOf)
        .sort();

      expect(markedSessionOnly).toEqual(Object.keys(SESSION_ONLY).sort());
      for (const controller of controllers.filter((c) => nameOf(c) in SESSION_ONLY)) {
        for (const [, handler] of handlersOf(controller)) {
          expect(isSessionOnly(controller, handler)).toBe(true);
        }
      }
    });

    it('never combines @Public with a feature or with @AuthenticatedOnly', () => {
      for (const controller of controllers) {
        for (const [name, handler] of handlersOf(controller)) {
          if (isPublic(controller, handler)) {
            expect({
              route: `${nameOf(controller)}.${name}`,
              feature: featureOf(controller, handler),
              sessionOnly: isSessionOnly(controller, handler),
            }).toEqual({
              route: `${nameOf(controller)}.${name}`,
              feature: undefined,
              sessionOnly: false,
            });
          }
        }
      }
    });
  });

  const protectedControllers = controllers.filter(
    (c) => !(nameOf(c) in PUBLIC) && !(nameOf(c) in SESSION_ONLY),
  );

  describe.each(protectedControllers.map((c) => [nameOf(c), c] as const))('%s', (_name, controller) => {
    it('has at least one route', () => {
      expect(handlersOf(controller).length).toBeGreaterThan(0);
    });

    it.each(handlerTable(controller))(
      '%s declares a feature that exists in the permission map',
      (_handlerName, handler) => {
        const feature = featureOf(controller, handler);

        expect(feature).toBeDefined();
        expect(isFeature(feature)).toBe(true);
      },
    );
  });

  it('has a controller behind every feature of the map, or says why not', () => {
    const used = new Set(
      protectedControllers.flatMap((controller) =>
        handlersOf(controller).map(([, handler]) => featureOf(controller, handler)),
      ),
    );

    for (const feature of FEATURES) {
      const covered = used.has(feature) || feature in FEATURES_WITHOUT_CONTROLLER;
      expect({ feature, covered }).toEqual({ feature, covered: true });
    }
  });

  it('keeps the no-controller list free of features that lost their entry', () => {
    for (const feature of Object.keys(FEATURES_WITHOUT_CONTROLLER)) {
      expect({ feature, inMap: FEATURES.some((f) => f === feature) }).toEqual({
        feature,
        inMap: true,
      });
    }
  });

  it('keeps the exempt lists free of controllers that no longer exist', () => {
    const names = new Set(controllers.map(nameOf));

    for (const exempt of [...Object.keys(PUBLIC), ...Object.keys(SESSION_ONLY)]) {
      expect({ exempt, exists: names.has(exempt) }).toEqual({ exempt, exists: true });
    }
  });
});
