import {
  ClassSerializerInterceptor,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validationPipeOptions } from './common/pipes/validation-pipe.options';
import databaseConfig from './config/database.config';
import r2Config from './config/r2.config';
import redisConfig from './config/redis.config';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AuthModule } from './auth/auth.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { BackupModule } from './modules/backup/backup.module';
import { RestoreModule } from './modules/restore/restore.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AuditModule } from './modules/audit/audit.module';
import { CronjobsModule } from './modules/cronjobs/cronjobs.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { HealthModule } from './health/health.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, r2Config, redisConfig],
      validationSchema: envValidationSchema,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.getOrThrow<number>('THROTTLE_TTL_MS'),
            limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
    DatabaseModule,
    AuthModule,
    ConnectionsModule,
    BackupModule,
    RestoreModule,
    JobsModule,
    AuditModule,
    CronjobsModule,
    MaintenanceModule,
    HealthModule,
    QueueModule,
  ],
  providers: [
    // Global rate limit. Per-IP by default; @SkipThrottle() opts out
    // (used on /health so Kubernetes probes don't get 429s).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe(validationPipeOptions),
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*splat}');
  }
}
