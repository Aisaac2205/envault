import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { BetterAuthGuard } from '../../../auth/auth.guard';
import { RolesGuard, Roles } from '../../../auth/roles.guard';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { AnalyticsWindowQueryDto } from './dto/analytics-window-query.dto';

@Controller('jobs/analytics')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class JobsAnalyticsController {
  constructor(private readonly service: JobsAnalyticsService) {}

  @Get('daily')
  getDailySeries(@Query() query: AnalyticsWindowQueryDto) {
    return this.service.getDailySeries(query.window);
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
