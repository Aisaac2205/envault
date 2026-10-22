import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { setAuditContext } from '../../common/audit/audit-context';
import { CronjobsService } from './cronjobs.service';
import { ConnectionsService } from '../connections/connections.service';
import { CreateCronjobDto } from './dto/create-cronjob.dto';
import { UpdateCronjobDto } from './dto/update-cronjob.dto';

@Controller('cronjobs')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class CronjobsController {
  constructor(
    private readonly service: CronjobsService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateCronjobDto, @Req() req: Request) {
    const result = await this.service.create(dto);
    const connection = await this.connectionsService.findById(dto.connectionId);
    setAuditContext(req, {
      environment: connection.environment,
      resourceId: result.id,
      metadata: { connectionId: dto.connectionId, cronExpression: dto.cronExpression },
    });
    return result;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCronjobDto,
    @Req() req: Request,
  ) {
    const result = await this.service.update(id, dto);
    const connection = await this.connectionsService.findById(result.connectionId);
    setAuditContext(req, { environment: connection.environment });
    return result;
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const existing = await this.service.findById(id);
    const connection = await this.connectionsService.findById(existing.connectionId);
    setAuditContext(req, { environment: connection.environment });
    return this.service.delete(id);
  }

  @Post(':id/toggle')
  async toggle(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const result = await this.service.toggle(id);
    const connection = await this.connectionsService.findById(result.connectionId);
    setAuditContext(req, { environment: connection.environment });
    return result;
  }
}
