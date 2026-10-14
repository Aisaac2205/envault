import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@Controller('audit')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  getLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.service.getLogs(query);
  }

  @Get(':id')
  getLogById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getLogById(id);
  }
}
