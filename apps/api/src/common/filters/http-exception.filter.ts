import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    statusCode: number;
  };
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : String(
              (exceptionResponse as Record<string, unknown>)['message'] ??
                exception.message,
            );

      const body: ErrorBody = {
        error: {
          code: exception.name,
          message,
          statusCode,
        },
        timestamp: new Date().toISOString(),
        path: request.url,
      };

      if (exception instanceof TooManyRequestsException) {
        response.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
      response.status(statusCode).json(body);
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const body: ErrorBody = {
      error: {
        code: 'InternalServerError',
        message: 'Internal server error',
        statusCode: 500,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(500).json(body);
  }
}
