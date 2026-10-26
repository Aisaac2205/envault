/// <reference types="jest" />
import { Request } from 'express';
import { getAuditContext } from '../../common/audit/audit-context';
import { CronFrequency } from '../../database/enums/cron-frequency.enum';
import { Environment } from '../../database/enums/environment.enum';
import { CronjobsController } from './cronjobs.controller';
import { CronjobsService } from './cronjobs.service';
import { ConnectionsService } from '../connections/connections.service';

describe('CronjobsController audit context', () => {
  let controller: CronjobsController;
  let service: { create: jest.Mock };
  let connectionsService: { findById: jest.Mock };

  beforeEach(() => {
    service = { create: jest.fn() };
    connectionsService = { findById: jest.fn(async () => ({ environment: Environment.PROD })) };
    controller = new CronjobsController(
      service as unknown as CronjobsService,
      connectionsService as unknown as ConnectionsService,
    );
  });

  // A request that names a schedule carries no cronExpression of its own: the
  // service derives it, so the audit entry must read the stored value.
  it('records the stored cronExpression when the cronjob was created from a schedule', async () => {
    const req = {} as Request;
    service.create.mockResolvedValue({ id: 'cron-1', cronExpression: '0 2 * * *' });

    await controller.create(
      { name: 'Nightly', connectionId: 'conn-1', schedule: { kind: 'daily', time: '02:00' } },
      req,
    );

    expect(getAuditContext(req)).toEqual({
      environment: Environment.PROD,
      resourceId: 'cron-1',
      metadata: { connectionId: 'conn-1', cronExpression: '0 2 * * *' },
    });
  });

  it('records the cronExpression of a legacy request as stored', async () => {
    const req = {} as Request;
    service.create.mockResolvedValue({ id: 'cron-1', cronExpression: '0 5 * * *' });

    await controller.create(
      {
        name: 'Nightly',
        connectionId: 'conn-1',
        cronExpression: '0 5 * * *',
        frequency: CronFrequency.DAILY,
      },
      req,
    );

    expect(getAuditContext(req)?.metadata).toEqual({
      connectionId: 'conn-1',
      cronExpression: '0 5 * * *',
    });
  });
});
