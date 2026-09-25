import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListJobsQueryDto } from './list-jobs-query.dto';
import { Environment } from '../../../database/enums/environment.enum';
import { JobStatus } from '../../../database/enums/job-status.enum';

describe('ListJobsQueryDto', () => {
  it('passes validation with empty filters', async () => {
    const dto = plainToInstance(ListJobsQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes validation with valid status, environment, and limit', async () => {
    const dto = plainToInstance(ListJobsQueryDto, {
      status: 'completed',
      environment: 'prod',
      limit: '10',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.status).toBe(JobStatus.COMPLETED);
    expect(dto.environment).toBe(Environment.PROD);
    expect(dto.limit).toBe(10);
  });

  it('passes validation with valid dates', async () => {
    const dto = plainToInstance(ListJobsQueryDto, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.from).toBeInstanceOf(Date);
    expect(dto.to).toBeInstanceOf(Date);
  });

  it('fails validation when limit is less than 1', async () => {
    const dto = plainToInstance(ListJobsQueryDto, { limit: '0' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('fails validation when limit exceeds 100', async () => {
    const dto = plainToInstance(ListJobsQueryDto, { limit: '101' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('fails validation when status enum is invalid', async () => {
    const dto = plainToInstance(ListJobsQueryDto, { status: 'invalid_status' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('fails validation when environment enum is invalid', async () => {
    const dto = plainToInstance(ListJobsQueryDto, { environment: 'invalid_env' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('environment');
  });

  it('fails validation when date is malformed', async () => {
    const dto = plainToInstance(ListJobsQueryDto, { from: 'not-a-date' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('from');
  });
});
