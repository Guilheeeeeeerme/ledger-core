import { Prisma } from '@prisma/client';
import { DomainError, validateTransfer } from './domain/validateTransfer';

type RawTransaction = {
  id: string;
  source_account_id?: string;
  destination_account_id?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  amount: string | number | bigint;
  currency: string;
  description?: string;
  status: string;
  error_code?: string | null;
  errorCode?: string | null;
  created_at?: Date | string;
  createdAt?: Date | string;
  processed_at?: Date | string | null;
  processedAt?: Date | string | null;
};

type RawAccount = {
  id: string;
  currency: string;
  balance: string | number | bigint;
};

function createLedgerService(prisma: any) {
  async function createPendingTransfer(input: Parameters<typeof validateTransfer>[0]) {
    const transfer = validateTransfer(input);
    try {
      const created = await prisma.transaction.create({
        data: {
          id: transfer.transactionId,
          sourceAccountId: transfer.sourceAccountId,
          destinationAccountId: transfer.destinationAccountId,
          amount: BigInt(transfer.amount),
          currency: transfer.currency,
          description: transfer.description,
          status: 'pending'
        }
      });
      return mapTransaction(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await getTransaction(transfer.transactionId);
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

  async function processTransfer(transactionId: string) {
    return prisma.$transaction(async (tx: { $queryRaw: Function; $executeRaw: Function }) => {
      const transactionRows = await tx.$queryRaw`
        SELECT * FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE
      ` as RawTransaction[];
      const transaction = transactionRows[0];

      if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      if (transaction.status !== 'pending') return mapTransaction(transaction);

      const sourceAccountId = String(transaction.source_account_id ?? transaction.sourceAccountId);
      const destinationAccountId = String(transaction.destination_account_id ?? transaction.destinationAccountId);
      const accountIds = [sourceAccountId, destinationAccountId].sort();
      const [firstId, secondId] = accountIds;
      const accountRows = await tx.$queryRaw`
        SELECT id, currency, balance FROM accounts
        WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
        ORDER BY id FOR UPDATE
      ` as RawAccount[];

      if (accountRows.length !== 2) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const accounts = new Map<string, RawAccount>(accountRows.map((account) => [account.id, account]));
      const source = accounts.get(sourceAccountId);
      const destination = accounts.get(destinationAccountId);
      if (!source || !destination) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }
      const amount = Number(transaction.amount);

      if (source.currency.trim() !== String(transaction.currency).trim()
        || destination.currency.trim() !== String(transaction.currency).trim()) {
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      await tx.$executeRaw`
        INSERT INTO ledger_entries (transaction_id, account_id, amount)
        VALUES (${transaction.id}::uuid, ${source.id}::uuid, ${-amount}::bigint),
               (${transaction.id}::uuid, ${destination.id}::uuid, ${amount}::bigint)
      `;
      await tx.$executeRaw`
        UPDATE accounts
        SET balance = balance + CASE WHEN id = ${source.id}::uuid THEN ${-amount}::bigint ELSE ${amount}::bigint END
        WHERE id IN (${source.id}::uuid, ${destination.id}::uuid)
      `;
      const completed = await tx.$queryRaw`
        UPDATE transactions
        SET status = 'completed', processed_at = NOW(), error_code = NULL
        WHERE id = ${transaction.id}::uuid
        RETURNING *
      ` as RawTransaction[];
      return mapTransaction(completed[0]);
    });
  }

  async function markFailed(id: string, code: string) {
    await prisma.$executeRaw`
      UPDATE transactions SET status = 'failed', error_code = ${code}, processed_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending'
    `;
    return getTransaction(id);
  }

  async function getTransaction(id: string) {
    const row = await prisma.transaction.findUnique({ where: { id } });
    return row ? mapTransaction(row) : null;
  }

  async function listAccounts() {
    const rows = await prisma.account.findMany({ orderBy: { name: 'asc' } }) as Array<Record<string, unknown>>;
    return rows.map((account: Record<string, unknown>) => ({
      id: account.id,
      name: account.name,
      currency: String(account.currency).trim(),
      balance: Number(account.balance),
      created_at: account.createdAt ?? account.created_at
    }));
  }

  async function listAccountHistory(accountId: string) {
    const rows = await prisma.$queryRaw`
      SELECT e.id, e.transaction_id, e.amount, e.created_at, t.description, t.currency,
             CASE WHEN t.source_account_id = ${accountId}::uuid THEN t.destination_account_id
                  ELSE t.source_account_id END AS counterparty_account_id
      FROM ledger_entries e
      JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${accountId}::uuid
      ORDER BY e.created_at DESC
    ` as Array<Record<string, unknown>>;
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

  return {
    createPendingTransfer,
    processTransfer,
    markFailed,
    getTransaction,
    listAccounts,
    listAccountHistory
  };
}

function mapTransaction(row: Record<string, unknown> | RawTransaction) {
  const record = row as Record<string, unknown>;
  return {
    id: record.id,
    sourceAccountId: record.sourceAccountId ?? record.source_account_id,
    destinationAccountId: record.destinationAccountId ?? record.destination_account_id,
    amount: Number(record.amount),
    currency: String(record.currency).trim(),
    description: record.description ?? '',
    status: record.status,
    errorCode: record.errorCode ?? record.error_code ?? null,
    createdAt: record.createdAt ?? record.created_at,
    processedAt: record.processedAt ?? record.processed_at ?? null
  };
}

export { createLedgerService };
export type LedgerService = ReturnType<typeof createLedgerService>;
