/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';
import { UpdateConnectionDto } from './update-connection.dto';

// PartialType copies the validation rules of CreateConnectionDto and also runs
// its property initializers, so a default declared on the create DTO would be
// present on every update instance and silently overwrite the stored value
// (PATCH { name } turned a MySQL connection into a PostgreSQL one). These cases
// run through the same pipe options as the application, so they describe the
// object that PATCH /api/connections/:id hands to the service.
describe('UpdateConnectionDto', () => {
  const pipe = new ValidationPipe(validationPipeOptions);

  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateConnectionDto }) as Promise<UpdateConnectionDto>;

  it('carries only the fields the request names', async () => {
    const dto = await validate({ name: 'Renamed' });

    expect(Object.keys(dto)).toEqual(['name']);
    expect(dto).not.toHaveProperty('dbType');
  });

  it.each([
    ['an empty body', {}],
    ['a rename', { name: 'Renamed' }],
    ['a new password', { password: 'new-secret' }],
    ['a new port', { port: 5433 }],
  ])('has no field with an undefined value for %s', async (_title, body) => {
    const dto = await validate(body);

    expect(Object.entries(dto).filter(([, value]) => value === undefined)).toEqual([]);
  });

  it.each(Object.values(DbTypeEnum))('keeps the engine the request names: %s', async (dbType) => {
    await expect(validate({ dbType })).resolves.toMatchObject({ dbType });
  });

  it('rejects an unknown engine with 400', async () => {
    await expect(validate({ dbType: 'oracle' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
