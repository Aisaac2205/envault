import {
  FEATURES,
  PERMISSIONS,
  ROLES,
  canAccess,
  featuresForRole,
  isFeature,
  parseRoles,
} from './permissions';

describe('permission map', () => {
  it('only names roles the system knows', () => {
    for (const [feature, roles] of Object.entries(PERMISSIONS)) {
      for (const role of roles) {
        expect({ feature, role, known: ROLES.includes(role) }).toEqual({
          feature,
          role,
          known: true,
        });
      }
    }
  });

  it('keeps every current feature admin-only (the role split has not changed)', () => {
    for (const feature of FEATURES) {
      expect({ feature, roles: PERMISSIONS[feature] }).toEqual({
        feature,
        roles: ['admin'],
      });
    }
  });

  it('lists the features in declaration order', () => {
    expect(FEATURES).toEqual([
      'dashboard',
      'dumps',
      'restore',
      'cronjobs',
      'connections',
      'cleanup',
      'audit',
      'users',
    ]);
  });
});

describe('isFeature', () => {
  it('recognises the features in the map', () => {
    expect(isFeature('audit')).toBe(true);
  });

  it.each(['nope', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'rejects %p',
    (value) => {
      expect(isFeature(value)).toBe(false);
    },
  );

  it.each([undefined, null, 42, {}, ['audit']])('rejects the non-string %p', (value) => {
    expect(isFeature(value)).toBe(false);
  });
});

describe('canAccess (default-deny)', () => {
  it('lets admin reach every feature', () => {
    for (const feature of FEATURES) {
      expect(canAccess('admin', feature)).toBe(true);
    }
  });

  it('denies the regular user every feature', () => {
    for (const feature of FEATURES) {
      expect(canAccess('user', feature)).toBe(false);
    }
  });

  it('denies a role that is not in the map', () => {
    expect(canAccess('viewer', 'dashboard')).toBe(false);
  });

  it('denies a missing role', () => {
    expect(canAccess(undefined, 'dashboard')).toBe(false);
    expect(canAccess('', 'dashboard')).toBe(false);
  });

  it('denies a feature that is not in the map, even to admin', () => {
    expect(canAccess('admin', 'billing')).toBe(false);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not treat the inherited property %p as a feature',
    (name) => {
      expect(canAccess('admin', name)).toBe(false);
    },
  );
});

describe('featuresForRole', () => {
  it('returns every feature for admin, in declaration order', () => {
    expect(featuresForRole('admin')).toEqual([...FEATURES]);
  });

  it('returns nothing for the regular user', () => {
    expect(featuresForRole('user')).toEqual([]);
  });

  it('returns nothing for an unknown role', () => {
    expect(featuresForRole('viewer')).toEqual([]);
    expect(featuresForRole(undefined)).toEqual([]);
  });
});

describe('roles stored as a comma-separated list (Better Auth)', () => {
  it('splits the list on commas exactly like Better Auth, dropping empty entries', () => {
    expect(parseRoles('admin,user')).toEqual(['admin', 'user']);
    expect(parseRoles('user,,admin,')).toEqual(['user', 'admin']);
    expect(parseRoles(',,')).toEqual([]);
    expect(parseRoles('')).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });

  it('grants a feature when ANY of the roles is allowed', () => {
    expect(canAccess('admin,user', 'audit')).toBe(true);
    expect(canAccess('user,admin', 'audit')).toBe(true);
  });

  it('does not trim: Better Auth would not match " admin" either, so neither do we', () => {
    expect(parseRoles(' admin , user ')).toEqual([' admin ', ' user ']);
    expect(canAccess(' admin', 'audit')).toBe(false);
    expect(canAccess('admin ', 'audit')).toBe(false);
    expect(canAccess(' admin ', 'audit')).toBe(false);
    expect(canAccess('user, admin', 'audit')).toBe(false);
  });

  it('matches role names exactly, case included', () => {
    expect(canAccess('Admin', 'audit')).toBe(false);
    expect(canAccess('ADMIN,user', 'audit')).toBe(false);
    expect(canAccess('administrator', 'audit')).toBe(false);
  });

  it('denies when none of the roles is allowed', () => {
    expect(canAccess('user,viewer', 'audit')).toBe(false);
    expect(canAccess(',,', 'audit')).toBe(false);
  });

  it('reports the union of the features of every role', () => {
    expect(featuresForRole('admin,user')).toEqual([...FEATURES]);
    expect(featuresForRole(' admin ')).toEqual([]);
    expect(featuresForRole('Admin')).toEqual([]);
    expect(featuresForRole('user,viewer')).toEqual([]);
  });

  it('unions the features of a custom map', () => {
    const map = { dashboard: ['viewer'], audit: ['admin'] } as const;

    expect(featuresForRole('viewer,admin', map)).toEqual(['dashboard', 'audit']);
    expect(featuresForRole('viewer,user', map)).toEqual(['dashboard']);
  });
});

describe('a future role is a data change', () => {
  // The functions take the map as data, so a role added to it later needs no
  // new branch anywhere: this is the only thing a `viewer` would change.
  const withViewer = {
    dashboard: ['admin', 'viewer'],
    audit: ['admin'],
  } as const;

  it('grants the new role exactly the features listed for it', () => {
    expect(canAccess('viewer', 'dashboard', withViewer)).toBe(true);
    expect(canAccess('viewer', 'audit', withViewer)).toBe(false);
    expect(featuresForRole('viewer', withViewer)).toEqual(['dashboard']);
  });

  it('still denies the regular user', () => {
    expect(featuresForRole('user', withViewer)).toEqual([]);
  });
});
