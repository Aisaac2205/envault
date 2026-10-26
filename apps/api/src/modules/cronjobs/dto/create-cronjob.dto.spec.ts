/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { CronFrequency } from '../../../database/enums/cron-frequency.enum';
import { CreateCronjobDto } from './create-cronjob.dto';
import {
  DailyScheduleDto,
  EveryHoursScheduleDto,
  MonthlyScheduleDto,
  WeeklyScheduleDto,
} from './schedule.dto';

// These cases run through the same pipe options as the application, so they
// describe the object that POST /api/cronjobs hands to the service. The mix of
// `schedule` with `cronExpression` or `frequency` is the service's to reject
// (it is the one place that resolves what to store), not the pipe's.
describe('CreateCronjobDto', () => {
  const pipe = new ValidationPipe(validationPipeOptions);
  const base = { name: 'Nightly', connectionId: 'conn-1' };

  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CreateCronjobDto }) as Promise<CreateCronjobDto>;

  const messagesOf = async (body: Record<string, unknown>): Promise<string> => {
    try {
      await validate(body);
    } catch (error) {
      const { message } = (error as BadRequestException).getResponse() as { message: string[] };
      return message.join('; ');
    }
    throw new Error('expected the payload to be rejected');
  };

  describe('legacy cronExpression and frequency', () => {
    it('accepts them together', async () => {
      const body = { ...base, cronExpression: '0 2 * * *', frequency: CronFrequency.DAILY };

      await expect(validate(body)).resolves.toEqual(body);
    });

    it.each([
      ['a missing cronExpression', { frequency: CronFrequency.DAILY }, 'cronExpression'],
      ['a missing frequency', { cronExpression: '0 2 * * *' }, 'frequency'],
      ['an empty cronExpression', { cronExpression: '', frequency: CronFrequency.DAILY }, 'cronExpression'],
      ['an unknown frequency', { cronExpression: '0 2 * * *', frequency: 'monthly' }, 'frequency'],
      ['a null cronExpression', { cronExpression: null, frequency: CronFrequency.DAILY }, 'cronExpression'],
    ])('rejects %s', async (_label, fields, property) => {
      await expect(validate({ ...base, ...fields })).rejects.toBeInstanceOf(BadRequestException);
      await expect(messagesOf({ ...base, ...fields })).resolves.toContain(property);
    });

    it('rejects a request with neither a schedule nor a cronExpression', async () => {
      await expect(validate(base)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('schedule', () => {
    it.each([
      [{ kind: 'every_hours', everyHours: 6 }, EveryHoursScheduleDto],
      [{ kind: 'daily', time: '02:00' }, DailyScheduleDto],
      [{ kind: 'weekly', time: '23:59', daysOfWeek: [0, 6] }, WeeklyScheduleDto],
      [{ kind: 'monthly', time: '00:00', dayOfMonth: 28 }, MonthlyScheduleDto],
    ])('accepts %j as its own variant', async (schedule, variant) => {
      const dto = await validate({ ...base, schedule });

      expect(dto.schedule).toEqual(schedule);
      expect(dto.schedule).toBeInstanceOf(variant);
      expect(dto.cronExpression).toBeUndefined();
      expect(dto.frequency).toBeUndefined();
    });

    it.each([1, 2, 3, 4, 6, 8, 12])('accepts every %i hours', async (everyHours) => {
      const schedule = { kind: 'every_hours', everyHours };

      await expect(validate({ ...base, schedule })).resolves.toMatchObject({ schedule });
    });

    it('lets the service see the mix of a schedule with the legacy fields', async () => {
      const body = {
        ...base,
        schedule: { kind: 'daily', time: '02:00' },
        cronExpression: '0 2 * * *',
        frequency: CronFrequency.DAILY,
      };

      await expect(validate(body)).resolves.toMatchObject(body);
    });

    it.each([
      ['an unknown kind', { kind: 'yearly', time: '02:00' }, 'kind'],
      ['a missing kind', { time: '02:00' }, 'kind'],
      ['a kind that is not text', { kind: 3 }, 'kind'],
      ['every 5 hours, which is not a divisor of 24', { kind: 'every_hours', everyHours: 5 }, 'everyHours'],
      ['every 24 hours', { kind: 'every_hours', everyHours: 24 }, 'everyHours'],
      ['every 0 hours', { kind: 'every_hours', everyHours: 0 }, 'everyHours'],
      ['every 1.5 hours', { kind: 'every_hours', everyHours: 1.5 }, 'everyHours'],
      ['every hours with no everyHours', { kind: 'every_hours' }, 'everyHours'],
      ['every hours with a null everyHours', { kind: 'every_hours', everyHours: null }, 'everyHours'],
      ['every hours with a time', { kind: 'every_hours', everyHours: 2, time: '02:00' }, 'time'],
      ['a daily schedule with no time', { kind: 'daily' }, 'time'],
      ['a daily schedule with a null time', { kind: 'daily', time: null }, 'time'],
      ['hour 24', { kind: 'daily', time: '24:00' }, 'time'],
      ['minute 60', { kind: 'daily', time: '12:60' }, 'time'],
      ['a time with no leading zero', { kind: 'daily', time: '9:00' }, 'time'],
      ['a time with seconds', { kind: 'daily', time: '12:00:00' }, 'time'],
      ['a time that is a number', { kind: 'daily', time: 1200 }, 'time'],
      ['a time that is a list', { kind: 'daily', time: ['12:00'] }, 'time'],
      ['a daily schedule with days', { kind: 'daily', time: '02:00', daysOfWeek: [1] }, 'daysOfWeek'],
      ['a weekly schedule with no days', { kind: 'weekly', time: '02:00' }, 'daysOfWeek'],
      ['a weekly schedule with an empty list of days', { kind: 'weekly', time: '02:00', daysOfWeek: [] }, 'daysOfWeek'],
      ['a weekly schedule with days that are not a list', { kind: 'weekly', time: '02:00', daysOfWeek: 'mon' }, 'daysOfWeek'],
      ['day 7', { kind: 'weekly', time: '02:00', daysOfWeek: [7] }, 'daysOfWeek'],
      ['day -1', { kind: 'weekly', time: '02:00', daysOfWeek: [-1] }, 'daysOfWeek'],
      ['a fractional day', { kind: 'weekly', time: '02:00', daysOfWeek: [1.5] }, 'daysOfWeek'],
      ['a day given as text', { kind: 'weekly', time: '02:00', daysOfWeek: ['1'] }, 'daysOfWeek'],
      ['a repeated day', { kind: 'weekly', time: '02:00', daysOfWeek: [1, 1] }, 'daysOfWeek'],
      ['a weekly schedule with a bad time', { kind: 'weekly', time: '25:00', daysOfWeek: [1] }, 'time'],
      ['a monthly schedule with no day', { kind: 'monthly', time: '02:00' }, 'dayOfMonth'],
      ['day of month 0', { kind: 'monthly', time: '02:00', dayOfMonth: 0 }, 'dayOfMonth'],
      ['day of month 29', { kind: 'monthly', time: '02:00', dayOfMonth: 29 }, 'dayOfMonth'],
      ['a fractional day of month', { kind: 'monthly', time: '02:00', dayOfMonth: 1.5 }, 'dayOfMonth'],
      ['a day of month that is not a number', { kind: 'monthly', time: '02:00', dayOfMonth: 'last' }, 'dayOfMonth'],
      ['a monthly schedule with a bad time', { kind: 'monthly', time: '2am', dayOfMonth: 1 }, 'time'],
    ])('rejects %s', async (_label, schedule, property) => {
      await expect(validate({ ...base, schedule })).rejects.toBeInstanceOf(BadRequestException);
      await expect(messagesOf({ ...base, schedule })).resolves.toContain(property);
    });

    it.each([
      ['null', null],
      ['text', 'daily'],
      ['a number', 5],
      ['a list', [{ kind: 'daily', time: '02:00' }]],
    ])('rejects a schedule that is %s', async (_label, schedule) => {
      await expect(validate({ ...base, schedule })).rejects.toBeInstanceOf(BadRequestException);
      await expect(messagesOf({ ...base, schedule })).resolves.toContain('schedule');
    });
  });
});
