import { Module, OnModuleDestroy } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { BetterAuthGuard } from './auth.guard';
import { BetterAuthPasswordConfirmation } from './better-auth-password-confirmation';
import { PasswordConfirmation } from './password-confirmation';
import { AdminSeedService } from './seeds/admin.seed';
import { authPool } from './auth.config';

@Module({
  controllers: [AuthController],
  providers: [
    BetterAuthGuard,
    AdminSeedService,
    { provide: PasswordConfirmation, useClass: BetterAuthPasswordConfirmation },
  ],
  exports: [BetterAuthGuard, PasswordConfirmation],
})
export class AuthModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await authPool.end();
  }
}
