import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BrokerService } from '../broker/broker.service';
import { DomainError } from '../domain/validateTransfer';
import { LedgerService } from '../ledger/ledger.service';
import { HEALTH_CHECK } from '../tokens';

@Controller()
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly brokerService: BrokerService,
    @Inject(HEALTH_CHECK) private readonly healthCheck: () => Promise<unknown>
  ) {}

  @Get('api/health')
  async health() {
    await this.healthCheck();
    return { status: 'ok', stack: process.env.STACK_NAME || 'nestjs-typeorm-rabbitmq' };
  }

  @Get('api/accounts')
  async listAccounts() {
    return { accounts: await this.ledgerService.listAccounts() };
  }

  @Get('api/accounts/:id/transactions')
  async listAccountHistory(@Param('id') id: string) {
    return { transactions: await this.ledgerService.listAccountHistory(id) };
  }

  @Get('api/transactions/:id')
  async getTransaction(@Param('id') id: string) {
    const transaction = await this.ledgerService.getTransaction(id);
    if (!transaction) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
    }
    return transaction;
  }

  @Post('api/transactions')
  @HttpCode(202)
  async createTransfer(@Body() body: Record<string, unknown>) {
    const input = {
      ...body,
      transactionId: body?.transactionId || randomUUID()
    };
    const transaction = await this.ledgerService.createPendingTransfer(input);
    if (transaction.status === 'pending') {
      await this.brokerService.publishTransfer(transaction.id);
    }
    console.log(`[ledger] POST /api/transactions accepted id=${transaction.id}`);
    return transaction;
  }
}
