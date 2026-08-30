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
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<{ method?: string; path?: string; url?: string; body?: { transactionId?: string } }>();
    if (isDomainError(exception)) {
      const path = request.path || request.url || '';
      if (request.method === 'POST' && String(path).includes('api/transactions')) {
        console.log(`[ledger] POST /api/transactions rejected code=${exception.code} id=${request.body?.transactionId || '-'}`);
      }
      return response.status(exception.status || 400).json({
        error: { code: exception.code, message: exception.message }
      });
    }
    const err = exception as { message?: string };
    console.error(`[ledger] internal error message=${err?.message || 'unknown'}`);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' }
    });
  }
}
