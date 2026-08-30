import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, validateTransfer } from '../domain/validateTransfer';
import { PrismaService } from '../prisma/prisma.service';

type TransactionRow = {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount: bigint | number | string;
  currency: string;
  description: string;
  status: string;
  error_code: string | null;
  created_at: Date;
  processed_at: Date | null;
};

type AccountRow = {
  id: string;
  currency: string;
  balance: bigint | number | string;
};

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async createPendingTransfer(input: Record<string, unknown>) {
    const transfer = validateTransfer(input);
    const inserted = await this.prisma.$queryRawUnsafe<TransactionRow[]>(
      `INSERT INTO transactions
        (id, source_account_id, destination_account_id, amount, currency, description, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'pending')
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      transfer.transactionId,
      transfer.sourceAccountId,
      transfer.destinationAccountId,
      transfer.amount,
      transfer.currency,
      transfer.description
    );

    if (inserted.length === 1) return mapTransaction(inserted[0]);

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
    return this.prisma.$transaction(async (tx) => {
      const transactionResult = await tx.$queryRawUnsafe<TransactionRow[]>(
        'SELECT * FROM transactions WHERE id = $1::uuid FOR UPDATE',
        transactionId
      );
      const transaction = transactionResult[0];

      if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      if (transaction.status !== 'pending') return mapTransaction(transaction);

      const accountIds = [transaction.source_account_id, transaction.destination_account_id].sort();
      const accountResult = await tx.$queryRawUnsafe<AccountRow[]>(
        'SELECT id, currency, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        accountIds
      );

      if (accountResult.length !== 2) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const accounts = new Map(accountResult.map((account) => [account.id, account]));
      const source = accounts.get(transaction.source_account_id)!;
      const destination = accounts.get(transaction.destination_account_id)!;
      const amount = Number(transaction.amount);

      if (source.currency.trim() !== transaction.currency.trim()
        || destination.currency.trim() !== transaction.currency.trim()) {
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO ledger_entries (transaction_id, account_id, amount)
         VALUES ($1::uuid, $2::uuid, $3), ($1::uuid, $4::uuid, $5)`,
        transaction.id,
        source.id,
        -amount,
        destination.id,
        amount
      );
      await tx.$executeRawUnsafe(
        `UPDATE accounts
         SET balance = balance + CASE WHEN id = $1::uuid THEN $3::bigint ELSE $4::bigint END
         WHERE id IN ($1::uuid, $2::uuid)`,
        source.id,
        destination.id,
        -amount,
        amount
      );
      const completed = await tx.$queryRawUnsafe<TransactionRow[]>(
        `UPDATE transactions
         SET status = 'completed', processed_at = NOW(), error_code = NULL
         WHERE id = $1::uuid RETURNING *`,
        transaction.id
      );
      return mapTransaction(completed[0]);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
    });
  }

  async markFailed(id: string, code: string) {
    const result = await this.prisma.$queryRawUnsafe<TransactionRow[]>(
      `UPDATE transactions SET status = 'failed', error_code = $2, processed_at = NOW()
       WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
      id,
      code
    );
    return result[0] ? mapTransaction(result[0]) : this.getTransaction(id);
  }

  async getTransaction(id: string) {
    const result = await this.prisma.$queryRawUnsafe<TransactionRow[]>(
      'SELECT * FROM transactions WHERE id = $1::uuid',
      id
    );
    return result[0] ? mapTransaction(result[0]) : null;
  }

  async listAccounts() {
    const result = await this.prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      currency: string;
      balance: bigint | number | string;
      created_at: Date;
    }>>('SELECT id, name, currency, balance, created_at FROM accounts ORDER BY name');
    return result.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency.trim(),
      balance: Number(account.balance),
      created_at: account.created_at
    }));
  }

  async listAccountHistory(accountId: string) {
    const result = await this.prisma.$queryRawUnsafe<Array<{
      id: string;
      transaction_id: string;
      amount: bigint | number | string;
      created_at: Date;
      description: string;
      currency: string;
      counterparty_account_id: string;
    }>>(
      `SELECT e.id, e.transaction_id, e.amount, e.created_at, t.description, t.currency,
              CASE WHEN t.source_account_id = $1::uuid THEN t.destination_account_id
                   ELSE t.source_account_id END AS counterparty_account_id
       FROM ledger_entries e
       JOIN transactions t ON t.id = e.transaction_id
       WHERE e.account_id = $1::uuid
       ORDER BY e.created_at DESC`,
      accountId
    );
    return result.map((entry) => ({
      id: entry.id,
      transactionId: entry.transaction_id,
      amount: Number(entry.amount),
      currency: entry.currency.trim(),
      description: entry.description,
      counterpartyAccountId: entry.counterparty_account_id,
      createdAt: entry.created_at
    }));
  }
}

function mapTransaction(row: TransactionRow) {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    destinationAccountId: row.destination_account_id,
    amount: Number(row.amount),
    currency: row.currency.trim(),
    description: row.description,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    processedAt: row.processed_at
  };
}
