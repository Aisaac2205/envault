import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ManualRetentionSettingEntity } from '../../database/entities/manual-retention-setting.entity';
import { ConnectionRetentionPolicyEntity } from '../../database/entities/connection-retention-policy.entity';
import { BackupModule } from '../backup/backup.module';
import { RestoreModule } from '../restore/restore.module';
import { ConnectionsModule } from '../connections/connections.module';
import { QueueModule } from '../queue/queue.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { RetentionProcessor } from './retention.processor';
import { RETENTION_QUEUE_NAME } from './maintenance.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ManualRetentionSettingEntity, ConnectionRetentionPolicyEntity]),
    BackupModule,
    RestoreModule,
    ConnectionsModule,
    QueueModule,
    BullModule.registerQueue({
      name: RETENTION_QUEUE_NAME,
    }),
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, RetentionProcessor],
  exports: [MaintenanceService, RetentionProcessor],
})
export class MaintenanceModule {}
