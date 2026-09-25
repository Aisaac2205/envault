import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { setAuditContext } from '../../common/audit/audit-context';
import { ConnectionsService } from '../connections/connections.service';
import { RestoreService } from './restore.service';
import { CreateRestoreDto } from './dto/create-restore.dto';
import { DryRunResult } from './interfaces/dry-run-result.interface';

@Controller('restores')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class RestoreController {
  constructor(
    private readonly service: RestoreService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createRestore(
    @Body() dto: CreateRestoreDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ jobId: string; dryRunResult?: DryRunResult }> {
    const result = await this.service.createRestore(dto, user);
    const connection = await this.connectionsService.findById(dto.targetConnectionId);
    setAuditContext(req, {
      environment: connection.environment,
      resourceId: result.jobId,
      metadata: {
        targetConnectionId: dto.targetConnectionId,
        sourceBackupId: dto.sourceBackupId,
        r2Key: dto.r2Key,
        isDryRun: dto.isDryRun,
      },
    });
    return result;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRestore(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.service.cancelRestore(id, user);
    setAuditContext(req, {
      resourceId: id,
      metadata: { action: 'cancel' },
    });
    return result;
  }

  @Get()
  listRestores() {
    return this.service.listRestores();
  }

  @Get(':id')
  getRestoreById(@Param('id') id: string) {
    return this.service.getRestoreById(id);
  }
}
