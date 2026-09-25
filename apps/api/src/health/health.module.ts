import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BackupModule } from '../modules/backup/backup.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, BackupModule],
  controllers: [HealthController],
})
export class HealthModule {}

