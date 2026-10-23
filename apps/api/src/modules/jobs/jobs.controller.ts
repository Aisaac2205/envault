import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/authorization';
import { JobsService } from './jobs.service';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';

@Controller('jobs')
@RequirePermission('dashboard')
export class JobsController {
  constructor(private readonly service: JobsService) {}

  @Get('backups')
  getBackupJobs(@Query() filters: ListJobsQueryDto) {
    return this.service.getBackupJobs(filters);
  }

  @Get('backups/:id')
  getBackupJobById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getBackupJobById(id);
  }

  @Get('restores')
  getRestoreJobs(@Query() filters: ListJobsQueryDto) {
    return this.service.getRestoreJobs(filters);
  }

  @Get('restores/:id')
  getRestoreJobById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getRestoreJobById(id);
  }

  @Get('summary')
  getSummary() {
    return this.service.getSummary();
  }

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get('daily-counts')
  getDailyCounts() {
    return this.service.getDailyCounts();
  }
}

