import 'reflect-metadata';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  type DynamicModule
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { DomainError } from './domain/validateTransfer';
import type { LedgerService } from './ledgerService';

const LEDGER_SERVICE = 'LEDGER_SERVICE';
const PUBLISH_TRANSFER = 'PUBLISH_TRANSFER';
const HEALTH_CHECK = 'HEALTH_CHECK';

type AppDeps = {
  ledgerService: Pick<LedgerService, 'createPendingTransfer' | 'getTransaction' | 'listAccounts' | 'listAccountHistory'>;
  publishTransfer: (transactionId: string) => Promise<unknown> | unknown;
  healthCheck: () => Promise<unknown> | unknown;
};

@Catch()
class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<express.Response>();
    const request = http.getRequest<express.Request>();
    const isDomain = exception instanceof DomainError
      || Boolean(exception && typeof exception === 'object' && (exception as DomainError).name === 'DomainError' && (exception as DomainError).code);
    if (isDomain) {
      const domain = exception as DomainError;
      const path = request.path || request.url || '';
      if (request.method === 'POST' && String(path).includes('api/transactions')) {
        console.log(`[ledger] POST /api/transactions rejected code=${domain.code} id=${(request.body as { transactionId?: string })?.transactionId || '-'}`);
      }
      return response.status(domain.status).json({
        error: { code: domain.code, message: domain.message }
      });
    }
    const err = exception as { message?: string };
    console.error(`[ledger] internal error message=${err?.message || 'unknown'}`);
    return response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' }
    });
  }
}

@Controller()
class LedgerController {
  constructor(
    @Inject(LEDGER_SERVICE) private readonly ledgerService: AppDeps['ledgerService'],
    @Inject(PUBLISH_TRANSFER) private readonly publishTransfer: AppDeps['publishTransfer'],
    @Inject(HEALTH_CHECK) private readonly healthCheck: AppDeps['healthCheck']
  ) {}

  @Get('/api/health')
  async health() {
    await this.healthCheck();
    return { status: 'ok', stack: process.env.STACK_NAME || 'nestjs-prisma-bullmq' };
  }

  @Get('/api/accounts')
  async listAccounts() {
    return { accounts: await this.ledgerService.listAccounts() };
  }

  @Get('/api/accounts/:id/transactions')
  async listHistory(@Param('id') id: string) {
    return { transactions: await this.ledgerService.listAccountHistory(id) };
  }

  @Get('/api/transactions/:id')
  async getTransaction(@Param('id') id: string) {
    const transaction = await this.ledgerService.getTransaction(id);
    if (!transaction) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
    }
    return transaction;
  }

  @Post('/api/transactions')
  @HttpCode(202)
  async createTransaction(@Body() body: Record<string, unknown>) {
    const input = {
      ...body,
      transactionId: (body.transactionId as string | undefined) || randomUUID()
    };
    const transaction = await this.ledgerService.createPendingTransfer(input);
    if (transaction.status === 'pending') await this.publishTransfer(transaction.id as string);
    console.log(`[ledger] POST /api/transactions accepted id=${transaction.id}`);
    return transaction;
  }
}

@Module({})
class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [LedgerController],
      providers: [
        { provide: LEDGER_SERVICE, useValue: deps.ledgerService },
        { provide: PUBLISH_TRANSFER, useValue: deps.publishTransfer },
        { provide: HEALTH_CHECK, useValue: deps.healthCheck }
      ]
    };
  }
}

async function createApp(deps: AppDeps) {
  const server = express();
  server.use(express.json());
  server.use(express.static(join(process.cwd(), 'public')));

  const nestApp = await NestFactory.create(
    AppModule.forRoot(deps),
    new ExpressAdapter(server),
    { logger: false }
  );
  nestApp.useGlobalFilters(new DomainExceptionFilter());
  await nestApp.init();

  Object.assign(server, {
    closeNest: () => nestApp.close()
  });
  return server;
}

export { createApp };
