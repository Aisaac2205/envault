import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('redis.url') ||
          configService.get<string>('REDIS_URL');

        if (redisUrl) {
          return {
            connection: {
              url: redisUrl,
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
              retryStrategy: (times: number) => Math.min(times * 100, 3000),
            },
          };
        }

        const host =
          configService.get<string>('redis.host') ||
          configService.get<string>('REDIS_HOST', 'localhost');
        const port =
          configService.get<number>('redis.port') ||
          configService.get<number>('REDIS_PORT', 6379);
        const password =
          configService.get<string>('redis.password') ||
          configService.get<string>('REDIS_PASSWORD');
        const tls =
          configService.get<boolean>('redis.tls') ||
          configService.get<boolean>('REDIS_TLS', false);

        return {
          connection: {
            host,
            port,
            password: password || undefined,
            tls: tls ? {} : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy: (times: number) => Math.min(times * 100, 3000),
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
