import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 for a limit a service enforces itself. HttpExceptionFilter turns
 * `retryAfterSeconds` into the Retry-After header, as the auth rate limiter
 * and the global ThrottlerGuard send it.
 */
export class TooManyRequestsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
