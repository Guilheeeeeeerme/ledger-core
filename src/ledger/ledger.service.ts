import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DomainError, validateTransfer } from '../domain/validateTransfer';
import { Account } from '../entities/account.entity';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import { LedgerTransaction } from '../entities/transaction.entity';

type TransactionRow = {
  id: string;
  sourceAccountId?: string;
  source_account_id?: string;
  destinationAccountId?: string;
  destination_account_id?: string;
  amount: string | number;
  currency: string;
  description: string;
  status: string;
  errorCode?: string | null;
  error_code?: string | null;
  createdAt?: Date;
  created_at?: Date;
  processedAt?: Date | null;
  processed_at?: Date | null;
};

@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async createPendingTransfer(input: Parameters<typeof validateTransfer>[0]) {
    const transfer = validateTransfer(input);
    const result = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(LedgerTransaction)
      .values({
        id: transfer.transactionId,
        sourceAccountId: transfer.sourceAccountId,
        destinationAccountId: transfer.destinationAccountId,
        amount: String(transfer.amount),
        currency: transfer.currency,
        description: transfer.description,
        status: 'pending'
      })
      .orIgnore()
      .returning('*')
      .execute();

    if (Array.isArray(result.raw) && result.raw.length === 1) {
      return mapTransaction(result.raw[0]);
    }

    const existing = await this.getTransaction(transfer.transactionId);
    const samePayload = existing
      && existing.sourceAccountId === transfer.sourceAccountId
      && existing.destinationAccountId === transfer.destinationAccountId
      && existing.amount === transfer.amount
      && existing.currency === transfer.currency;

    if (!samePayload) {
      throw new DomainError('TRANSACTION_CONFLICT', 'transactionId already has another payload', 409);
    }
    return existing;
  }

  async processTransfer(transactionId: string) {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const transaction = await manager.findOne(LedgerTransaction, {
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' }
      });

      if (!transaction) {
        throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      }
      if (transaction.status !== 'pending') return mapTransaction(transaction);

      const accountIds = [transaction.sourceAccountId, transaction.destinationAccountId].sort();
      const accounts = await manager
        .createQueryBuilder(Account, 'account')
        .where('account.id IN (:...ids)', { ids: accountIds })
        .orderBy('account.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();

      if (accounts.length !== 2) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const byId = new Map(accounts.map((account) => [account.id, account]));
      const source = byId.get(transaction.sourceAccountId);
      const destination = byId.get(transaction.destinationAccountId);
      const amount = Number(transaction.amount);

      if (!source || !destination) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }
      if (source.currency.trim() !== transaction.currency.trim()
        || destination.currency.trim() !== transaction.currency.trim()) {
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      await manager.save(LedgerEntry, [
        { transactionId: transaction.id, accountId: source.id, amount: String(-amount) },
        { transactionId: transaction.id, accountId: destination.id, amount: String(amount) }
      ]);

      source.balance = String(Number(source.balance) - amount);
      destination.balance = String(Number(destination.balance) + amount);
      await manager.save([source, destination]);

      transaction.status = 'completed';
      transaction.errorCode = null;
      transaction.processedAt = new Date();
      await manager.save(transaction);
      return mapTransaction(transaction);
    });
  }

  async markFailed(id: string, code: string) {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(LedgerTransaction)
      .set({ status: 'failed', errorCode: code, processedAt: () => 'NOW()' })
      .where('id = :id AND status = :status', { id, status: 'pending' })
      .returning('*')
      .execute();

    if (Array.isArray(result.raw) && result.raw[0]) {
      return mapTransaction(result.raw[0]);
    }
    return this.getTransaction(id);
  }

  async getTransaction(id: string) {
    const row = await this.dataSource.getRepository(LedgerTransaction).findOneBy({ id });
    return row ? mapTransaction(row) : null;
  }

  async listAccounts() {
    const accounts = await this.dataSource.getRepository(Account).find({
      order: { name: 'ASC' }
    });
    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency.trim(),
      balance: Number(account.balance),
      createdAt: account.createdAt
    }));
  }

  async listAccountHistory(accountId: string) {
    const rows = await this.dataSource.query(
      `SELECT e.id, e.transaction_id, e.amount, e.created_at, t.description, t.currency,
              CASE WHEN t.source_account_id = $1 THEN t.destination_account_id
                   ELSE t.source_account_id END AS counterparty_account_id
       FROM ledger_entries e
       JOIN transactions t ON t.id = e.transaction_id
       WHERE e.account_id = $1
       ORDER BY e.created_at DESC`,
      [accountId]
    );
    return rows.map((entry: Record<string, unknown>) => ({
      id: entry.id,
      transactionId: entry.transaction_id,
      amount: Number(entry.amount),
      currency: String(entry.currency).trim(),
      description: entry.description,
      counterpartyAccountId: entry.counterparty_account_id,
      createdAt: entry.created_at
    }));
  }
}

function mapTransaction(row: TransactionRow) {
  return {
    id: row.id,
    sourceAccountId: row.sourceAccountId ?? row.source_account_id,
    destinationAccountId: row.destinationAccountId ?? row.destination_account_id,
    amount: Number(row.amount),
    currency: String(row.currency).trim(),
    description: row.description,
    status: row.status,
    errorCode: row.errorCode ?? row.error_code ?? null,
    createdAt: row.createdAt ?? row.created_at,
    processedAt: row.processedAt ?? row.processed_at ?? null
  };
}
