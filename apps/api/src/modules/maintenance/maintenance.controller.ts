import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { RequirePermission } from '../../common/authorization';
import { setAuditContext } from '../../common/audit/audit-context';
import { Environment } from '../../database/enums/environment.enum';
import { MaintenanceService } from './maintenance.service';
import { CleanupParamsDto } from './dto/cleanup-params.dto';
import { UpdateManualRetentionDto } from './dto/update-manual-retention.dto';
import { UpdateConnectionRetentionDto } from './dto/update-connection-retention.dto';
import { DbHygieneQueryDto } from './dto/db-hygiene.query.dto';

@Controller('maintenance')
@RequirePermission('cleanup')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  // Dry run: what an ad-hoc cleanup would remove. Read-only, no audit.
  @Get('cleanup/preview')
  previewCleanup(@Query() query: CleanupParamsDto) {
    return this.service.previewCleanup(query);
  }

  @Post('cleanup')
  async runCleanup(@Body() dto: CleanupParamsDto, @Req() req: Request) {
    const result = await this.service.runCleanup(dto);
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: {
        connectionSlug: dto.connectionSlug,
        category: dto.category,
        keepLast: dto.keepLast,
        maxAgeDays: dto.maxAgeDays,
        maxTotalSizeMb: dto.maxTotalSizeMb,
        deleted: result.deleted,
        freedMb: result.freedMb,
        errors: result.errors.length,
      },
    });
    return result;
  }

  // --- Storage overview (read-only) ---

  @Get('storage/overview')
  getStorageOverview() {
    return this.service.getStorageOverview();
  }

  // --- DB hygiene: prune old FAILED job rows ---

  @Get('db/preview')
  previewDbHygiene(@Query() query: DbHygieneQueryDto) {
    return this.service.previewDbHygiene(query.olderThanDays);
  }

  @Post('db/cleanup')
  async runDbHygiene(@Body() dto: DbHygieneQueryDto, @Req() req: Request) {
    const result = await this.service.runDbHygiene(dto.olderThanDays);
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: { olderThanDays: dto.olderThanDays, deleted: result.deleted },
    });
    return result;
  }

  // --- Reconciliation (R2 <-> DB drift) ---

  @Get('reconcile/preview')
  reconcilePreview() {
    return this.service.reconcilePreview();
  }

  @Post('reconcile')
  async reconcileRun(@Req() req: Request) {
    const result = await this.service.reconcileRun();
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: {
        dbRowsDeleted: result.dbRowsDeleted,
        manifestsDeleted: result.manifestsDeleted,
        dumpsDeleted: result.dumpsDeleted,
        untrackedKept: result.untrackedKept,
        errors: result.errors.length,
      },
    });
    return result;
  }

  // --- Global manual-dump retention policy ---

  @Get('retention/manual')
  getManualRetention() {
    return this.service.getManualRetention();
  }

  @Put('retention/manual')
  async updateManualRetention(
    @Body() dto: UpdateManualRetentionDto,
    @Req() req: Request,
  ) {
    const result = await this.service.updateManualRetention(dto);
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: {
        enabled: result.enabled,
        keepLast: result.keepLast,
        maxAgeDays: result.maxAgeDays,
        maxTotalSizeMb: result.maxTotalSizeMb,
      },
    });
    return result;
  }

  // --- Per-connection retention policy ------------------------------------

  @Get('retention/:connectionSlug')
  getRetentionPolicies(@Param('connectionSlug') connectionSlug: string) {
    return this.service.getRetentionPolicies(connectionSlug);
  }

  @Put('retention/:connectionSlug')
  async updateRetentionPolicies(
    @Param('connectionSlug') connectionSlug: string,
    @Body() dto: UpdateConnectionRetentionDto,
    @Req() req: Request,
  ) {
    const result = await this.service.updateRetentionPolicies(
      connectionSlug,
      dto.policies,
    );
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: {
        connectionSlug,
        policies: result.map((p) => ({
          category: p.category,
          retentionDays: p.retentionDays,
        })),
      },
    });
    return result;
  }

  @Get('retention/:connectionSlug/preview')
  previewRetentionForConnection(
    @Param('connectionSlug') connectionSlug: string,
  ) {
    return this.service.previewRetentionForConnection(connectionSlug);
  }

  @Post('retention/:connectionSlug/run')
  async runRetentionForConnection(
    @Param('connectionSlug') connectionSlug: string,
    @Req() req: Request,
  ) {
    const result = await this.service.runRetentionForConnection(connectionSlug);
    setAuditContext(req, {
      environment: Environment.PROD,
      metadata: {
        connectionSlug,
        results: result.map((r) => ({
          category: r.category,
          deleted: r.deleted,
          freedMb: r.freedMb,
          errors: r.errors,
        })),
      },
    });
    return result;
  }
}
