import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { R2Service } from '../modules/backup/r2.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly r2Service: R2Service,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
      async () => {
        const r2 = await this.r2Service.checkHealth();
        return {
          r2: {
            status: r2.status === 'down' ? 'down' : 'up',
            degraded: r2.status === 'down',
            latencyMs: r2.latencyMs,
            error: r2.error,
          },
        };
      },
    ]);
  }
}

