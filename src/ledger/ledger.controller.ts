import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/validateTransfer';
import { LedgerService } from './ledger.service';

export const PUBLISH_TRANSFER = 'PUBLISH_TRANSFER';
export const HEALTH_CHECK = 'HEALTH_CHECK';

@Controller()
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    @Inject(PUBLISH_TRANSFER) private readonly publishTransfer: (id: string) => Promise<void>,
    @Inject(HEALTH_CHECK) private readonly healthCheck: () => Promise<unknown>
  ) {}

  @Get('/api/health')
  async health() {
    await this.healthCheck();
    return { status: 'ok', stack: process.env.STACK_NAME || 'nestjs-prisma-kafka' };
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
  async createTransfer(@Body() body: Record<string, unknown>) {
    const input = {
      ...body,
      transactionId: (body.transactionId as string | undefined) || randomUUID()
    };
    const transaction = await this.ledgerService.createPendingTransfer(input);
    if (transaction.status === 'pending') await this.publishTransfer(transaction.id);
    return transaction;
  }
}
