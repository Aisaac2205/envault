import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { PasswordConfirmation } from '../../auth/password-confirmation';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { Environment } from '../../database/enums/environment.enum';
import { ConnectionsRepository } from './connections.repository';
import { DeleteConnectionDto } from './dto/delete-connection.dto';
import { FailedConfirmationLimiter } from './failed-confirmation-limiter';

/** Failed password confirmations an admin may make in one window. */
const MAX_FAILED_CONFIRMATIONS = 5;
const FAILED_CONFIRMATION_WINDOW_MS = 15 * 60_000;

/** Who asks for the delete: the signed-in admin and the request's headers. */
export interface DeleteRequester {
  user: AuthUser;
  headers: IncomingHttpHeaders;
}

/**
 * Deletes connections. The delete is a soft delete (`isActive = false`) and
 * never touches the database a connection points to, so a PROD connection may
 * be deleted too, by an admin who confirms it (security-model 1.1): the exact
 * connection name and their own password. A non-PROD delete needs neither.
 *
 * Kept apart from ConnectionsService, which other modules inject, so that only
 * this use case depends on the password check.
 */
@Injectable()
export class ConnectionDeletionService {
  // Failed password confirmations per admin, so a stolen session cannot guess
  // the password through this endpoint. In memory, like the auth rate limiter,
  // for the supported single API replica; a restart forgets them.
  private readonly failedConfirmations = new FailedConfirmationLimiter({
    maxFailures: MAX_FAILED_CONFIRMATIONS,
    windowMs: FAILED_CONFIRMATION_WINDOW_MS,
    maxKeys: 10_000,
  });

  constructor(
    private readonly repository: ConnectionsRepository,
    private readonly passwordConfirmation: PasswordConfirmation,
  ) {}

  async delete(
    id: string,
    confirmation: DeleteConnectionDto,
    requester: DeleteRequester,
  ): Promise<void> {
    // The environment of a PROD connection cannot change and no connection
    // can become PROD (ConnectionsService.update), so checking it before the
    // locked delete below cannot let an unconfirmed PROD delete through.
    const connection = await this.repository.findByIdSafe(id);
    if (!connection) {
      throw new NotFoundException(`Conexión con ID "${id}" no encontrada`);
    }
    if (connection.environment === Environment.PROD) {
      await this.confirmProdDelete(connection, confirmation, requester);
    }

    const result = await this.repository.softDelete(id);
    if (result === 'missing') {
      throw new NotFoundException(`Conexión con ID "${id}" no encontrada`);
    }
    if (result === 'leased') {
      throw new ForbiddenException(
        'No se puede eliminar una conexión con una restauración activa.',
      );
    }
  }

  private async confirmProdDelete(
    connection: ConnectionEntity,
    { confirmName, password }: DeleteConnectionDto,
    requester: DeleteRequester,
  ): Promise<void> {
    if (!confirmName || !password) {
      throw new ForbiddenException(
        'Eliminar una conexión de producción requiere el nombre exacto de la conexión (confirmName) y la contraseña del administrador (password).',
      );
    }
    if (confirmName !== connection.name) {
      throw new ForbiddenException(
        'El nombre de confirmación no coincide con el nombre de la conexión.',
      );
    }

    // One check at a time per admin, after the budget is read: only a wrong
    // password is recorded, and a check still running is not a failure.
    const attempt = await this.failedConfirmations.attempt(requester.user.id, () =>
      this.passwordConfirmation.verify(requester.headers, password),
    );
    if (attempt.outcome === 'locked') {
      throw new TooManyRequestsException(
        'Demasiadas confirmaciones de contraseña fallidas. Vuelva a intentarlo más tarde.',
        attempt.retryAfterSeconds,
      );
    }
    if (attempt.outcome === 'refused') {
      throw new ForbiddenException('La confirmación de contraseña falló.');
    }
  }
}
