import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { buildRedisConnectionOptions } from '../../config/redis-connection';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          ...buildRedisConnectionOptions(configService),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => Math.min(times * 100, 3000),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
