import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { ConnectionDeletionService } from './connection-deletion.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { ConnectionsRepository } from './connections.repository';

@Module({
  // AuthModule provides PasswordConfirmation, the step-up check of a PROD delete.
  imports: [TypeOrmModule.forFeature([ConnectionEntity]), AuthModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ConnectionDeletionService, ConnectionsRepository],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
