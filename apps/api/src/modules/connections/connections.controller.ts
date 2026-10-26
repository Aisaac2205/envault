import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUser, CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/authorization';
import { setAuditContext } from '../../common/audit/audit-context';
import { ConnectionDeletionService } from './connection-deletion.service';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { DeleteConnectionDto } from './dto/delete-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { TestRawConnectionDto } from './dto/test-raw-connection.dto';

@Controller('connections')
@RequirePermission('connections')
export class ConnectionsController {
  constructor(
    private readonly service: ConnectionsService,
    private readonly deletion: ConnectionDeletionService,
  ) {}

  @Get()
  findAll(@Query('environment') environment?: string) {
    return this.service.findAll(environment);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateConnectionDto, @Req() req: Request) {
    const result = await this.service.create(dto);
    setAuditContext(req, {
      environment: result.environment,
      resourceId: result.id,
    });
    return result;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
    @Req() req: Request,
  ) {
    // Set before the update, so that a PATCH the service refuses (one on a
    // PROD connection) is still audited under the environment it targeted.
    const existing = await this.service.findByIdSafe(id);
    setAuditContext(req, { environment: existing.environment });
    const result = await this.service.update(id, dto);
    setAuditContext(req, { environment: result.environment });
    return result;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteConnectionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const existing = await this.service.findByIdSafe(id);
    setAuditContext(req, { environment: existing.environment });
    return this.deletion.delete(id, dto, { user, headers: req.headers });
  }

  @Post('test-raw')
  testRaw(@Body() dto: TestRawConnectionDto) {
    return this.service.testRaw(dto);
  }

  @Post('test')
  testWithBody(@Body() dto: TestConnectionDto) {
    return this.service.testByConnectionId(dto.connectionId);
  }

  @Post(':id/test')
  async testById(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const connection = await this.service.findById(id);
    setAuditContext(req, { environment: connection.environment });
    return this.service.testByConnectionId(id);
  }
}
