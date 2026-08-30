import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
    const request = http.getRequest<Request>();

    if (isDomainError(exception) || exception instanceof DomainError) {
      const domain = exception as DomainError;
      const path = request.path || request.url || '';
      if (request.method === 'POST' && String(path).includes('api/transactions')) {
        console.log(`[ledger] POST /api/transactions rejected code=${domain.code} id=${(request.body as { transactionId?: string } | undefined)?.transactionId || '-'}`);
      }
      return response.status(domain.status).json({
        error: { code: domain.code, message: domain.message }
      });
    }

    if (exception instanceof HttpException) {
      return response.status(exception.getStatus()).json(exception.getResponse());
    }

    const err = exception as { message?: string };
    console.error(`[ledger] internal error message=${err?.message || 'unknown'}`);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' }
    });
  }
}
