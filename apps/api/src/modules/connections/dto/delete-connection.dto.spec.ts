/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { DeleteConnectionDto } from './delete-connection.dto';

// The body of DELETE /api/connections/:id, through the application's pipe
// options. Whether a PROD connection got both fields is the service's call;
// this only decides what a body may contain.
describe('DeleteConnectionDto', () => {
  const pipe = new ValidationPipe(validationPipeOptions);

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: DeleteConnectionDto }) as Promise<DeleteConnectionDto>;

  it.each([
    ['no body', undefined],
    ['an empty body', {}],
  ])('accepts %s: a non-PROD delete sends none', async (_case, body) => {
    await expect(validate(body)).resolves.toEqual({});
  });

  it('carries the confirmation of a PROD delete', async () => {
    await expect(validate({ confirmName: 'Billing', password: 'admin-password' })).resolves.toEqual({
      confirmName: 'Billing',
      password: 'admin-password',
    });
  });

  it.each([
    ['a non-string password', { password: ['admin-password'] }],
    ['a name longer than a connection name can be', { confirmName: 'x'.repeat(101) }],
    ['a password longer than Better Auth accepts', { password: 'x'.repeat(129) }],
    ['an unknown field', { confirmName: 'Billing', force: true }],
  ])('rejects %s with 400', async (_case, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
