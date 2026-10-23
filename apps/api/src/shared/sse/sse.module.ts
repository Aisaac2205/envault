import { Global, Module } from '@nestjs/common';
import { SseService } from './sse.service';
import { sseRedisProvider } from './sse-redis.provider';

@Global()
@Module({
  providers: [sseRedisProvider, SseService],
  exports: [SseService],
})
export class SseModule {}
