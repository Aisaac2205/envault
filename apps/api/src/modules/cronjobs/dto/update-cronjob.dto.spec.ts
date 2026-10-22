/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { CronFrequency } from '../../../database/enums/cron-frequency.enum';
import { UpdateCronjobDto } from './update-cronjob.dto';

// PartialType marks every field with @IsOptional(), which skips validation for
// null as well as for a missing field, so `{ name: null }` reached the database
// and failed there with a 500. The retention limits are the exception: they
// are nullable columns, and null is how a limit is removed. These cases run
// through the same pipe options as the application, so they describe the
// object that PATCH /api/cronjobs/:id hands to the service.
describe('UpdateCronjobDto', () => {
  const pipe = new ValidationPipe(validationPipeOptions);

  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateCronjobDto }) as Promise<UpdateCronjobDto>;

  it('carries only the fields the request names', async () => {
    const dto = await validate({ name: 'Renamed' });

    expect(Object.keys(dto)).toEqual(['name']);
  });

  it.each([
    ['name', 'Renamed'],
    ['cronExpression', '0 5 * * *'],
    ['frequency', CronFrequency.WEEKLY],
    ['isActive', false],
    ['retentionEnabled', true],
    ['retentionKeepLast', 3],
  ])('accepts a new %s', async (field, value) => {
    await expect(validate({ [field]: value })).resolves.toEqual({ [field]: value });
  });

  it.each(['name', 'connectionId', 'cronExpression', 'frequency', 'isActive', 'retentionEnabled'])(
    'rejects a null %s with 400',
    async (field) => {
      await expect(validate({ [field]: null })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['retentionKeepLast', 'retentionMaxAgeDays', 'retentionMaxSizeMb'])(
    'accepts a null %s, which removes that retention limit',
    async (field) => {
      await expect(validate({ [field]: null })).resolves.toEqual({ [field]: null });
    },
  );

  it('rejects an unknown frequency with 400', async () => {
    await expect(validate({ frequency: 'monthly' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
