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

  describe('schedule', () => {
    it('accepts a new schedule', async () => {
      const schedule = { kind: 'weekly', time: '02:00', daysOfWeek: [1, 3] };

      await expect(validate({ schedule })).resolves.toEqual({ schedule });
    });

    it('accepts a request that leaves the schedule out', async () => {
      await expect(validate({ name: 'Renamed' })).resolves.toEqual({ name: 'Renamed' });
    });

    it('rejects a null schedule with 400', async () => {
      await expect(validate({ schedule: null })).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['an unknown kind', { kind: 'yearly' }],
      ['an everyHours outside the allowed set', { kind: 'every_hours', everyHours: 5 }],
      ['a bad time', { kind: 'daily', time: '24:00' }],
      ['no days', { kind: 'weekly', time: '02:00', daysOfWeek: [] }],
      ['a day of month past 28', { kind: 'monthly', time: '02:00', dayOfMonth: 29 }],
    ])('rejects %s with 400', async (_label, schedule) => {
      await expect(validate({ schedule })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets the service see the mix of a schedule with a legacy field', async () => {
      const body = { schedule: { kind: 'daily', time: '02:00' }, cronExpression: '0 2 * * *' };

      await expect(validate(body)).resolves.toMatchObject(body);
    });
  });
});
