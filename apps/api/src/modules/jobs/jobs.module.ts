import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsRepository } from './jobs.repository';
import { JobsAnalyticsController } from './analytics/jobs-analytics.controller';
import { JobsAnalyticsService } from './analytics/jobs-analytics.service';
import { JobsAnalyticsRepository } from './analytics/jobs-analytics.repository';

@Module({
  imports: [TypeOrmModule.forFeature([BackupJobEntity, RestoreJobEntity, ConnectionEntity])],
  controllers: [JobsAnalyticsController, JobsController],
  providers: [JobsService, JobsRepository, JobsAnalyticsService, JobsAnalyticsRepository],
})
export class JobsModule {}
