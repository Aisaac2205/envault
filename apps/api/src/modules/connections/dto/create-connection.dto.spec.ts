/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';
import { Environment } from '../../../database/enums/environment.enum';
import { CreateConnectionDto } from './create-connection.dto';

// A connection created without `dbType` is a PostgreSQL one. That default is
// the column default of ConnectionEntity; the DTO must not repeat it, because
// UpdateConnectionDto inherits the DTO's property initializers (see
// update-connection.dto.spec.ts).
describe('CreateConnectionDto', () => {
  const pipe = new ValidationPipe(validationPipeOptions);
  const payload = {
    name: 'Billing',
    environment: Environment.PROD,
    host: 'db.internal',
    port: 5432,
    database: 'billing',
    username: 'billing_user',
    password: 'secret',
  };

  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CreateConnectionDto }) as Promise<CreateConnectionDto>;

  it('leaves dbType unset when the request omits it, so that the entity default applies', async () => {
    const dto = await validate(payload);

    expect(dto.dbType).toBeUndefined();
  });

  it('declares PostgreSQL as the default engine of the stored connection', () => {
    const column = getMetadataArgsStorage().columns.find(
      ({ target, propertyName }) => target === ConnectionEntity && propertyName === 'dbType',
    );

    expect(column?.options.default).toBe(DbTypeEnum.POSTGRES);
  });

  it.each(Object.values(DbTypeEnum))('keeps the engine the request names: %s', async (dbType) => {
    await expect(validate({ ...payload, dbType })).resolves.toMatchObject({ dbType });
  });

  it('rejects an unknown engine with 400', async () => {
    await expect(validate({ ...payload, dbType: 'oracle' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
