import { Body, Controller, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { setAuditContext } from '../../common/audit/audit-context';
import { CronjobsService } from './cronjobs.service';
import { ConnectionsService } from '../connections/connections.service';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Controller('backups/settings')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class BackupSettingsController {
  constructor(
    private readonly service: CronjobsService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  @Put(':connectionId')
  async upsertSchedule(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: UpdateScheduleDto,
    @Req() req: Request,
  ) {
    const result = await this.service.upsertSchedule(
      connectionId,
      dto.cronExpression,
      dto.name ?? 'Backup automático',
      dto.frequency,
    );
    const connection = await this.connectionsService.findById(connectionId);
    setAuditContext(req, {
      environment: connection.environment,
      resourceId: result.id,
      metadata: { connectionId, cronExpression: dto.cronExpression },
    });
    return result;
  }
}
