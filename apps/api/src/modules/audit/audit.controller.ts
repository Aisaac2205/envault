import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/authorization';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@Controller('audit')
@RequirePermission('audit')
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
