import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Sse,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { setAuditContext } from '../../common/audit/audit-context';
import { BackupService } from './backup.service';
import { SseService, SseEvent } from '../../shared/sse/sse.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { ListEnrichedDumpsQueryDto } from './dto/list-enriched-dumps.query.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { Environment } from '../../database/enums/environment.enum';

interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller('backups')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class BackupController {
  constructor(
    private readonly service: BackupService,
    private readonly sseService: SseService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createBackup(
    @Body() dto: CreateBackupDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.service.createBackup(dto, user);
    setAuditContext(req, {
      environment: Environment.PROD,
      resourceId: result.jobId,
      metadata: { fileKey: result.fileKey, connectionId: dto.connectionId },
    });
    return result;
  }

  // Literal routes must come before parameterized ones (:id)
  @Get('history')
  getHistory(@Query() query: ListHistoryQueryDto) {
    return this.service.getHistory(query);
  }

  @Get('r2/enriched')
  listEnrichedDumps(@Query() query: ListEnrichedDumpsQueryDto) {
    return this.service.listEnrichedDumps(query.connectionSlug, query.category);
  }

  @Get('r2')
  listDumpsFromR2() {
    return this.service.listDumpsFromR2();
  }

  @Post('trigger/:connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerManual(
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const result = await this.service.triggerManual(connectionId, user);
    setAuditContext(req, {
      environment: Environment.PROD,
      resourceId: result.jobId,
      metadata: { fileKey: result.fileKey, connectionId },
    });
    return result;
  }

  @Post(':id/download-url')
  async getDownloadUrl(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const result = await this.service.getDownloadUrl(id);
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: { fileKey: result.fileKey },
    });
    return result;
  }

  @Sse(':id/stream')
  async streamBackup(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const job = await this.service.getBackupById(id);
    if (!job) {
      throw new NotFoundException(`Backup job con ID "${id}" no encontrado`);
    }

    return this.sseService.subscribe(id).pipe(
      map((event: SseEvent): MessageEvent => ({ data: event })),
    );
  }

  @Get()
  listBackups() {
    return this.service.listBackups();
  }

  @Get(':id')
  getBackupById(@Param('id') id: string) {
    return this.service.getBackupById(id);
  }
}
