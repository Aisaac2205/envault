/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { R2Service } from '../modules/backup/r2.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealth: {
    check: jest.Mock;
  };
  let mockDb: {
    pingCheck: jest.Mock;
  };
  let mockR2Service: {
    checkHealth: jest.Mock;
  };

  beforeEach(async () => {
    mockHealth = {
      check: jest.fn().mockImplementation(async (indicators: Array<() => Promise<unknown>>) => {
        const results = await Promise.all(indicators.map((fn) => fn()));
        const info = Object.assign({}, ...results);
        return {
          status: 'ok',
          info,
          error: {},
          details: info,
        };
      }),
    };
    mockDb = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };
    mockR2Service = {
      checkHealth: jest.fn().mockResolvedValue({ status: 'up', latencyMs: 25 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealth },
        { provide: TypeOrmHealthIndicator, useValue: mockDb },
        { provide: R2Service, useValue: mockR2Service },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports database and r2 status when both are up', async () => {
    const result = await controller.check();

    expect(mockDb.pingCheck).toHaveBeenCalledWith('database');
    expect(mockR2Service.checkHealth).toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.info).toMatchObject({
      database: { status: 'up' },
      r2: { status: 'up', latencyMs: 25 },
    });
  });

  it('reports degraded r2 status non-fatally when r2 is down', async () => {
    mockR2Service.checkHealth.mockResolvedValueOnce({
      status: 'down',
      latencyMs: 500,
      error: 'R2 network timeout',
    });

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.info).toMatchObject({
      database: { status: 'up' },
      r2: { status: 'down', degraded: true, error: 'R2 network timeout' },
    });
  });
});
