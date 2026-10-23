import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { AUTHENTICATED_ONLY_KEY } from './authenticated-only.decorator';
import { FEATURES } from './permissions';
import { PermissionsController } from './permissions.controller';
import { PERMISSION_KEY } from './require-permission.decorator';

const user = (role: string): AuthUser => ({
  id: '1',
  email: 'someone@example.com',
  name: 'Someone',
  role,
});

describe('PermissionsController', () => {
  const controller = new PermissionsController();

  it('reports every feature to an admin, with the role', () => {
    expect(controller.getMine(user('admin'))).toEqual({
      role: 'admin',
      features: [...FEATURES],
    });
  });

  it('reports no feature to a regular user', () => {
    expect(controller.getMine(user('user'))).toEqual({
      role: 'user',
      features: [],
    });
  });

  it('reports no feature to a role the map does not know', () => {
    expect(controller.getMine(user('viewer'))).toEqual({
      role: 'viewer',
      features: [],
    });
  });

  it('reports the union of the features of a comma-separated role list', () => {
    expect(controller.getMine(user('user,admin'))).toEqual({
      role: 'user,admin',
      features: [...FEATURES],
    });
    expect(controller.getMine(user('user, admin'))).toEqual({
      role: 'user, admin',
      features: [],
    });
  });

  it('needs only a session: every signed-in user may read their own permissions', () => {
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, PermissionsController)).toBe(true);
    expect(Reflect.getMetadata(PERMISSION_KEY, PermissionsController)).toBeUndefined();
  });
});
