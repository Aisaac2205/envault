import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { auth, authPool } from '../auth.config';
import { PASSWORD_POLICY_ERROR_CODE } from '../password-policy/password-policy';

// The seeded account is always created with this name, and the password
// policy refuses a password that contains it.
const ADMIN_NAME = 'Admin';

function isPasswordPolicyRejection(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error as { body?: { code?: unknown } }).body?.code === PASSWORD_POLICY_ERROR_CODE
  );
}

@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  async onApplicationBootstrap(): Promise<void> {
    const email = process.env.BETTER_AUTH_ADMIN_EMAIL;
    const password = process.env.BETTER_AUTH_ADMIN_PASSWORD;

    if (!email || !password) {
      this.logger.warn(
        'BETTER_AUTH_ADMIN_EMAIL or BETTER_AUTH_ADMIN_PASSWORD not set — skipping admin seed',
      );
      return;
    }

    try {
      // Check if admin user already exists
      const { rows } = await authPool.query(
        'SELECT "id", "role" FROM "user" WHERE "email" = $1',
        [email],
      );

      if (rows.length > 0) {
        if (rows[0].role === 'admin') {
          this.logger.log('Admin user already exists — skipping seed');
          return;
        }
        // User exists but isn't admin — promote
        await authPool.query(
          'UPDATE "user" SET "role" = $1 WHERE "id" = $2',
          ['admin', rows[0].id],
        );
        this.logger.log('Existing user promoted to admin');
        return;
      }

      // Create user via public signup (no admin session needed)
      const result = await auth.api.signUpEmail({
        body: { email, password, name: ADMIN_NAME },
      });

      // Set role directly in DB — auth.api.setRole requires an admin
      // session which doesn't exist yet (chicken-and-egg).
      await authPool.query(
        'UPDATE "user" SET "role" = $1 WHERE "id" = $2',
        ['admin', result.user.id],
      );

      this.logger.log('Default admin user created');
    } catch (error) {
      // Checked before the duplicate-user test below, which reads the message:
      // a weak password is never "the admin already exists".
      if (isPasswordPolicyRejection(error)) {
        this.logger.error(
          `Failed to seed admin user: BETTER_AUTH_ADMIN_PASSWORD does not meet the password policy (${PASSWORD_POLICY_ERROR_CODE}). ${error.message} ` +
            `The admin account is named "${ADMIN_NAME}" and uses the email in BETTER_AUTH_ADMIN_EMAIL. ` +
            'No admin user was created: set a stronger password and restart.',
        );
        return;
      }

      const message =
        error instanceof Error ? error.message : JSON.stringify(error);

      if (message.includes('already') || message.includes('unique')) {
        this.logger.log('Admin user already exists — skipping seed');
        return;
      }

      this.logger.error(`Failed to seed admin user: ${message}`);
    }
  }
}
