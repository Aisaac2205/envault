import {
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { SseService, SseEvent } from '../../shared/sse/sse.service';
import { RestoreService } from './restore.service';

interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller('restores')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('admin')
export class RestoreSseController {
  constructor(
    private readonly sseService: SseService,
    private readonly restoreService: RestoreService,
  ) {}

  @Sse(':id/stream')
  async streamRestore(@Param('id', ParseUUIDPipe) id: string): Promise<Observable<MessageEvent>> {
    const job = await this.restoreService.getRestoreById(id);
    if (!job) {
      throw new NotFoundException(
        `Restore job con ID "${id}" no encontrado`,
      );
    }

    return this.sseService.subscribe(id).pipe(
      map((event: SseEvent): MessageEvent => ({ data: event })),
    );
  }
}
