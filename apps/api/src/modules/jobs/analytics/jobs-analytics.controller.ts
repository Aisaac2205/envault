import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../../common/authorization';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { AnalyticsWindowDto } from './dto/analytics-window.dto';
import { AnalyticsWindowQueryDto } from './dto/analytics-window-query.dto';

@Controller('jobs/analytics')
@RequirePermission('dashboard')
export class JobsAnalyticsController {
  constructor(private readonly service: JobsAnalyticsService) {}

  @Get('daily')
  getDailySeries(@Query() query: AnalyticsWindowQueryDto) {
    return this.service.getDailySeries(query.window, query.connectionId);
  }

  @Get('connections-health')
  getConnectionsHealth(@Query() query: AnalyticsWindowDto) {
    return this.service.getConnectionsHealth(query.window);
  }

  @Get('storage-by-connection')
  getStorageByConnection() {
    return this.service.getStorageByConnection();
  }

  @Get('restore-status')
  getRestoreStatusCounts() {
    return this.service.getRestoreStatusCounts();
  }
}
