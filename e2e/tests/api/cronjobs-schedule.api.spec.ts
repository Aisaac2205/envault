import type { APIResponse } from '@playwright/test';
import { assertOk } from '../../support/api';
import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test as base } from '../../support/fixtures';
import { uniqueName } from '../../support/unique';

// The structured `schedule` of a cronjob. The API builds the cron expression
// and the frequency from it, and reads a schedule back out of any stored
// expression it can represent (`null` for the rest). cronjobs.api.spec.ts
// covers the plain `cronExpression` + `frequency` path; the cases here that
// still use that pair only check that the response now carries `schedule` too.
//
// A cronjob is active from the moment it is created and joins the API's live
// scheduler, so the schedules below are picked so that nothing fires while the
// suite runs:
//   - daily and weekly jobs run at the time of day six hours from now, in UTC
//     (the time zone of the API container); weekly jobs also skip the weekday
//     of that moment, so their first run is more than a day away;
//   - monthly jobs run on a day of the month at least three days from today;
//   - the free-form expression is confined to 1 January, like the ones in
//     cronjobs.api.spec.ts;
//   - jobs that fire on the hour (every N hours, `0 * * * *`) or at 02:00 (the
//     legacy presets) have no value that is safe all day. Their tests create
//     the job, read it back and delete it within a second or two, so only a
//     run that straddles that moment could see one of them fire.
const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;

const JANUARY_FIRST = '0 0 1 1 *';
// Steps and ranges, as someone writing cron by hand would: no schedule kind can
// express it, so a response must answer `schedule: null`.
const FREE_FORM = '*/7 3-5 1 1 *';

type Frequency = 'hourly' | 'daily' | 'weekly' | 'custom';

type Schedule =
  | { kind: 'every_hours'; everyHours: 1 | 2 | 3 | 4 | 6 | 8 | 12 }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; daysOfWeek: number[] }
  | { kind: 'monthly'; time: string; dayOfMonth: number };

interface Cronjob {
  id: string;
  name: string;
  connectionId: string;
  cronExpression: string;
  frequency: Frequency;
  schedule: Schedule | null;
  isActive: boolean;
  nextRunAt: string | null;
}

interface CronjobFixtures {
  /**
   * Posts a cronjob for a new Postgres connection and returns the raw response.
   * The name is unique unless the body sets one. Whatever the API created is
   * deleted when the test ends, the cronjob first and the connection after, so
   * a request that should have been rejected leaves nothing behind either.
   */
  postCronjob: (body?: Record<string, unknown>) => Promise<APIResponse>;
  /** Like `postCronjob`, for a request that must answer 201. */
  createCronjob: (body: Record<string, unknown>) => Promise<Cronjob>;
}

const test = base.extend<CronjobFixtures>({
  postCronjob: async ({ adminApi, createConnection }, use) => {
    const createdIds: string[] = [];

    await use(async (body = {}) => {
      const { connection } = await createConnection();
      const response = await adminApi.post('cronjobs', {
        data: { name: uniqueName('cron'), connectionId: connection.id, ...body },
      });
      if (response.status() === 201) {
        const { data } = (await response.json()) as { data: Cronjob };
        createdIds.push(data.id);
      }
      return response;
    });

    // A test may delete its cronjob itself, so a 404 here is fine.
    for (const id of createdIds.reverse()) {
      const response = await adminApi.delete(`cronjobs/${id}`);
      if (response.status() !== 404) {
        await assertOk(response, `Cleaning up cronjob ${id}`);
      }
    }
  },

  createCronjob: async ({ postCronjob }, use) => {
    await use(async (body) => expectSuccessEnvelope<Cronjob>(await postCronjob(body), 201));
  },
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The time of day six hours from now (UTC) and its weekday, 0 = Sunday. A daily
 * job at that time first runs in about six hours, a weekly job on any other
 * weekday more than a day from now.
 */
function sixHoursAhead(): { time: string; hour: number; minute: number; weekday: number } {
  const at = new Date(Date.now() + 6 * HOUR_MS);
  const hour = at.getUTCHours();
  const minute = at.getUTCMinutes();
  return { time: `${pad(hour)}:${pad(minute)}`, hour, minute, weekday: at.getUTCDay() };
}

/** A day of the month at least three days from today, whichever day today is. */
function dayOfMonthAwayFromToday(): number {
  return new Date().getUTCDate() > 14 ? 5 : 20;
}

function expectFutureDate(value: string | null): void {
  expect(value).not.toBeNull();
  expect(new Date(value as string).getTime()).toBeGreaterThan(Date.now());
}

/**
 * The next run is ahead and no further away than one period of the schedule,
 * which shows that the schedule set the cadence and not just any date.
 */
function expectNextRunWithin(value: string | null, hours: number): void {
  expectFutureDate(value);
  const ahead = new Date(value as string).getTime() - Date.now();
  expect(ahead).toBeLessThanOrEqual(hours * HOUR_MS);
}

interface ScheduleCase {
  label: string;
  /** Built per test, because the schedules that cannot fire depend on the clock. */
  build: () => {
    schedule: Schedule;
    cronExpression: string;
    frequency: Frequency;
    /** What the response echoes, when it is not the schedule that was sent. */
    echoed?: Schedule;
    /** The longest the schedule can wait for its first run, plus an hour for daylight saving time. */
    withinHours: number;
  };
}

const SCHEDULE_CASES: ScheduleCase[] = [
  {
    label: 'every hour',
    build: () => ({
      schedule: { kind: 'every_hours', everyHours: 1 },
      cronExpression: '0 * * * *',
      frequency: 'hourly',
      withinHours: 1,
    }),
  },
  {
    label: 'every 6 hours',
    build: () => ({
      schedule: { kind: 'every_hours', everyHours: 6 },
      cronExpression: '0 */6 * * *',
      frequency: 'custom',
      withinHours: 6,
    }),
  },
  {
    label: 'a daily time',
    build: () => {
      const { time, hour, minute } = sixHoursAhead();
      return {
        schedule: { kind: 'daily', time },
        cronExpression: `${minute} ${hour} * * *`,
        frequency: 'daily',
        withinHours: DAY_HOURS + 1,
      };
    },
  },
  {
    label: 'a single weekday',
    build: () => {
      const { time, hour, minute, weekday } = sixHoursAhead();
      const day = (weekday + 3) % 7;
      return {
        schedule: { kind: 'weekly', time, daysOfWeek: [day] },
        cronExpression: `${minute} ${hour} * * ${day}`,
        frequency: 'weekly',
        withinHours: 7 * DAY_HOURS + 1,
      };
    },
  },
  {
    label: 'several weekdays, sent out of order',
    build: () => {
      const { time, hour, minute, weekday } = sixHoursAhead();
      const sent = [(weekday + 5) % 7, (weekday + 2) % 7];
      const sorted = [...sent].sort((a, b) => a - b);
      return {
        schedule: { kind: 'weekly', time, daysOfWeek: sent },
        echoed: { kind: 'weekly', time, daysOfWeek: sorted },
        cronExpression: `${minute} ${hour} * * ${sorted.join(',')}`,
        frequency: 'custom',
        withinHours: 7 * DAY_HOURS + 1,
      };
    },
  },
  {
    label: 'a day of the month',
    build: () => {
      const { time, hour, minute } = sixHoursAhead();
      const dayOfMonth = dayOfMonthAwayFromToday();
      return {
        schedule: { kind: 'monthly', time, dayOfMonth },
        cronExpression: `${minute} ${hour} ${dayOfMonth} * *`,
        frequency: 'custom',
        withinHours: 31 * DAY_HOURS + 1,
      };
    },
  },
];

test.describe('create with a schedule', () => {
  for (const { label, build } of SCHEDULE_CASES) {
    test(`derives the cron expression and frequency from ${label}`, async ({ request, createCronjob }) => {
      const { schedule, echoed = schedule, cronExpression, frequency, withinHours } = build();

      const cronjob = await createCronjob({ schedule });

      expect(cronjob).toMatchObject({ cronExpression, frequency, isActive: true });
      expect(cronjob.schedule).toEqual(echoed);
      expectNextRunWithin(cronjob.nextRunAt, withinHours);
      const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
      expect(reread).toMatchObject({ cronExpression, frequency, isActive: true, nextRunAt: cronjob.nextRunAt });
      expect(reread.schedule).toEqual(echoed);
    });
  }
});

test.describe('update with a schedule', () => {
  test('rebuilds the expression and frequency and moves the next run', async ({ request, createCronjob }) => {
    const { time, hour, minute, weekday } = sixHoursAhead();
    const cronjob = await createCronjob({ schedule: { kind: 'daily', time } });
    const daysOfWeek = [(weekday + 2) % 7, (weekday + 5) % 7].sort((a, b) => a - b);
    const schedule: Schedule = { kind: 'weekly', time, daysOfWeek };

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { schedule } }),
    );

    expect(updated).toMatchObject({
      id: cronjob.id,
      name: cronjob.name,
      cronExpression: `${minute} ${hour} * * ${daysOfWeek.join(',')}`,
      frequency: 'custom',
      isActive: true,
    });
    expect(updated.schedule).toEqual(schedule);
    expectNextRunWithin(updated.nextRunAt, 7 * DAY_HOURS + 1);
    // The daily job was due in about six hours; two other weekdays are over a day away.
    expect(new Date(updated.nextRunAt as string).getTime()).toBeGreaterThan(
      new Date(cronjob.nextRunAt as string).getTime(),
    );
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({
      cronExpression: updated.cronExpression,
      frequency: 'custom',
      isActive: true,
      nextRunAt: updated.nextRunAt,
    });
    expect(reread.schedule).toEqual(schedule);
  });

  test('keeps the schedule when only the name changes', async ({ request, createCronjob }) => {
    const { time, hour, minute } = sixHoursAhead();
    const schedule: Schedule = { kind: 'daily', time };
    const cronjob = await createCronjob({ schedule });
    const name = uniqueName('renamed');

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { name } }),
    );

    expect(updated).toMatchObject({
      name,
      cronExpression: `${minute} ${hour} * * *`,
      frequency: 'daily',
      isActive: true,
      nextRunAt: cronjob.nextRunAt,
    });
    expect(updated.schedule).toEqual(schedule);
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({ name, cronExpression: `${minute} ${hour} * * *`, nextRunAt: cronjob.nextRunAt });
    expect(reread.schedule).toEqual(schedule);
  });

  test('replaces a free-form expression with a schedule', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob({ cronExpression: FREE_FORM, frequency: 'custom' });
    expect(cronjob.schedule).toBeNull();
    const { time, hour, minute } = sixHoursAhead();
    const schedule: Schedule = { kind: 'daily', time };

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { schedule } }),
    );

    expect(updated).toMatchObject({ cronExpression: `${minute} ${hour} * * *`, frequency: 'daily', isActive: true });
    expect(updated.schedule).toEqual(schedule);
    expectNextRunWithin(updated.nextRunAt, DAY_HOURS + 1);
  });

  test('turns a schedule back into a plain expression when a cronExpression is sent', async ({
    request,
    createCronjob,
  }) => {
    const cronjob = await createCronjob({ schedule: { kind: 'daily', time: sixHoursAhead().time } });

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { cronExpression: JANUARY_FIRST, frequency: 'custom' } }),
    );

    expect(updated).toMatchObject({ cronExpression: JANUARY_FIRST, frequency: 'custom', isActive: true });
    expect(updated.schedule).toBeNull();
    expectFutureDate(updated.nextRunAt);
    expect(updated.nextRunAt).not.toBe(cronjob.nextRunAt);
  });
});

// What the rows that were created before `schedule` existed look like in a
// response, and that a request without `schedule` still works.
test.describe('legacy cronExpression and frequency', () => {
  const LEGACY_PRESETS: Array<{ cronExpression: string; frequency: Frequency; schedule: Schedule }> = [
    { cronExpression: '0 * * * *', frequency: 'hourly', schedule: { kind: 'every_hours', everyHours: 1 } },
    { cronExpression: '0 2 * * *', frequency: 'daily', schedule: { kind: 'daily', time: '02:00' } },
    { cronExpression: '0 2 * * 1', frequency: 'weekly', schedule: { kind: 'weekly', time: '02:00', daysOfWeek: [1] } },
  ];

  for (const { cronExpression, frequency, schedule } of LEGACY_PRESETS) {
    test(`reads "${cronExpression}" back as a ${schedule.kind} schedule`, async ({ request, createCronjob }) => {
      const cronjob = await createCronjob({ cronExpression, frequency });

      expect(cronjob).toMatchObject({ cronExpression, frequency, isActive: true });
      expect(cronjob.schedule).toEqual(schedule);
      expectFutureDate(cronjob.nextRunAt);
      const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
      expect(reread).toMatchObject({ cronExpression, frequency });
      expect(reread.schedule).toEqual(schedule);
    });
  }

  test('answers a null schedule for a free-form expression and still schedules it', async ({
    request,
    createCronjob,
  }) => {
    const cronjob = await createCronjob({ cronExpression: FREE_FORM, frequency: 'custom' });

    expect(cronjob).toMatchObject({ cronExpression: FREE_FORM, frequency: 'custom', isActive: true, schedule: null });
    expectFutureDate(cronjob.nextRunAt);
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({ cronExpression: FREE_FORM, schedule: null, nextRunAt: cronjob.nextRunAt });
  });

  test('lists every cronjob with its schedule', async ({ request, createCronjob }) => {
    const schedule: Schedule = { kind: 'daily', time: sixHoursAhead().time };
    const structured = await createCronjob({ schedule });
    const freeForm = await createCronjob({ cronExpression: FREE_FORM, frequency: 'custom' });

    const listed = await expectSuccessEnvelope<Cronjob[]>(await request.get('cronjobs'));

    expect(listed.find(({ id }) => id === structured.id)?.schedule).toEqual(schedule);
    expect(listed.find(({ id }) => id === freeForm.id)?.schedule).toBeNull();
  });
});

// The field name is part of the API's contract, unlike the wording around it,
// so each case checks that the message names the field that was wrong. That
// tells a rejection of the schedule apart from a request that fails for
// another reason.
interface RejectedBody {
  label: string;
  body: Record<string, unknown>;
  mentions: string;
}

const DAILY_AT_TWO: Schedule = { kind: 'daily', time: '02:00' };

const REJECTED_ON_CREATE: RejectedBody[] = [
  {
    label: 'a schedule next to a cronExpression',
    body: { schedule: DAILY_AT_TWO, cronExpression: JANUARY_FIRST },
    mentions: 'schedule',
  },
  {
    label: 'a schedule next to a frequency',
    body: { schedule: DAILY_AT_TWO, frequency: 'daily' },
    mentions: 'schedule',
  },
  { label: 'neither a schedule nor a cronExpression', body: {}, mentions: 'cronExpression' },
  { label: 'a null schedule', body: { schedule: null }, mentions: 'schedule' },
  { label: 'a time that does not exist', body: { schedule: { kind: 'daily', time: '25:00' } }, mentions: 'time' },
  { label: 'an unknown kind', body: { schedule: { kind: 'yearly', time: '02:00' } }, mentions: 'kind' },
  {
    label: 'a weekly schedule without days',
    body: { schedule: { kind: 'weekly', time: '02:00', daysOfWeek: [] } },
    mentions: 'daysOfWeek',
  },
  {
    label: 'every 5 hours, which does not divide a day',
    body: { schedule: { kind: 'every_hours', everyHours: 5 } },
    mentions: 'everyHours',
  },
  {
    label: 'day 31 of the month',
    body: { schedule: { kind: 'monthly', time: '02:00', dayOfMonth: 31 } },
    mentions: 'dayOfMonth',
  },
  {
    label: 'a field that belongs to another kind',
    body: { schedule: { kind: 'daily', time: '02:00', everyHours: 6 } },
    mentions: 'everyHours',
  },
];

const REJECTED_ON_UPDATE: RejectedBody[] = [
  { label: 'a null schedule', body: { schedule: null }, mentions: 'schedule' },
  {
    label: 'a schedule next to a cronExpression',
    body: { schedule: DAILY_AT_TWO, cronExpression: JANUARY_FIRST },
    mentions: 'schedule',
  },
  {
    label: 'a schedule next to a frequency',
    body: { schedule: DAILY_AT_TWO, frequency: 'daily' },
    mentions: 'schedule',
  },
  { label: 'a time that does not exist', body: { schedule: { kind: 'daily', time: '25:00' } }, mentions: 'time' },
];

test.describe('create with an invalid schedule', () => {
  for (const { label, body, mentions } of REJECTED_ON_CREATE) {
    test(`rejects ${label} with 400`, async ({ postCronjob }) => {
      const error = await expectErrorEnvelope(await postCronjob(body), 400);

      expect(error.error.message).toContain(mentions);
    });
  }
});

test.describe('update with an invalid schedule', () => {
  for (const { label, body, mentions } of REJECTED_ON_UPDATE) {
    test(`rejects ${label} with 400 and keeps the cronjob`, async ({ request, createCronjob }) => {
      const cronjob = await createCronjob({ schedule: { kind: 'daily', time: sixHoursAhead().time } });

      const error = await expectErrorEnvelope(
        await request.patch(`cronjobs/${cronjob.id}`, { data: body }),
        400,
      );

      expect(error.error.message).toContain(mentions);
      const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
      expect(reread).toMatchObject({
        cronExpression: cronjob.cronExpression,
        frequency: cronjob.frequency,
        isActive: true,
        nextRunAt: cronjob.nextRunAt,
      });
      expect(reread.schedule).toEqual(cronjob.schedule);
    });
  }
});
