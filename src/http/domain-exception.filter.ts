import {
  Catch,
  ExceptionFilter,
  ArgumentsHost
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../domain/validateTransfer';

function isDomainError(error: unknown): error is DomainError {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as DomainError).name === 'DomainError'
    && (error as DomainError).code
  );
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (isDomainError(exception)) {
      return response.status(exception.status || 400).json({
        error: { code: exception.code, message: exception.message }
      });
    }
    console.error(exception);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' }
    });
  }
}
