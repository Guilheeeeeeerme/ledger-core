const { DomainError, validateTransfer } = require('./domain/validateTransfer');

/**
 * Creates the domain boundary used by both HTTP routes and broker delivery.
 * The injected Prisma client keeps accounting policy independently testable.
 */
function createLedgerService(prisma) {
  async function createPendingTransfer(input) {
    const transfer = validateTransfer(input);
    const inserted = await prisma.$queryRaw`
      INSERT INTO transactions
        (id, source_account_id, destination_account_id, amount, currency, description, status)
      VALUES (
        ${transfer.transactionId}::uuid,
        ${transfer.sourceAccountId}::uuid,
        ${transfer.destinationAccountId}::uuid,
        ${transfer.amount}::bigint,
        ${transfer.currency},
        ${transfer.description},
        'pending'
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *`;

    if (inserted.length === 1) return mapTransaction(inserted[0]);

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

  /**
   * Applies one pending transfer exactly once. All financial mutations occur
   * inside the interactive Prisma transaction. Row locks use $queryRaw because
   * Prisma Client has no native FOR UPDATE.
   */
  async function processTransfer(transactionId) {
    return prisma.$transaction(async (tx) => {
      const transactionRows = await tx.$queryRaw`
        SELECT * FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
      const transaction = transactionRows[0];

      if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      // A redelivered broker message becomes a no-op after the first commit.
      if (transaction.status !== 'pending') return mapTransaction(transaction);

      // Stable lock ordering prevents opposite transfers from deadlocking each other.
      const accountIds = [transaction.source_account_id, transaction.destination_account_id].sort();
      const [firstId, secondId] = accountIds;
      const accountRows = await tx.$queryRaw`
        SELECT id, currency, balance FROM accounts
        WHERE id IN (${firstId}::uuid, ${secondId}::uuid)
        ORDER BY id FOR UPDATE`;

      if (accountRows.length !== 2) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const accounts = new Map(accountRows.map((account) => [String(account.id), account]));
      const source = accounts.get(String(transaction.source_account_id));
      const destination = accounts.get(String(transaction.destination_account_id));
      const amount = Number(transaction.amount);

      if (source.currency.trim() !== transaction.currency.trim()
        || destination.currency.trim() !== transaction.currency.trim()) {
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      // Both entries live in the same DB transaction; partial money movement cannot commit.
      await tx.$executeRaw`
        INSERT INTO ledger_entries (transaction_id, account_id, amount)
        VALUES (${transaction.id}::uuid, ${source.id}::uuid, ${-amount}::bigint),
               (${transaction.id}::uuid, ${destination.id}::uuid, ${amount}::bigint)`;
      await tx.$executeRaw`
        UPDATE accounts
        SET balance = balance + CASE WHEN id = ${source.id}::uuid THEN ${-amount}::bigint ELSE ${amount}::bigint END
        WHERE id IN (${source.id}::uuid, ${destination.id}::uuid)`;
      const completed = await tx.$queryRaw`
        UPDATE transactions
        SET status = 'completed', processed_at = NOW(), error_code = NULL
        WHERE id = ${transaction.id}::uuid
        RETURNING *`;
      return mapTransaction(completed[0]);
    });
  }

  async function markFailed(id, code) {
    const updated = await prisma.$queryRaw`
      UPDATE transactions SET status = 'failed', error_code = ${code}, processed_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending' RETURNING *`;
    return updated[0] ? mapTransaction(updated[0]) : getTransaction(id);
  }

  async function getTransaction(id) {
    const row = await prisma.transaction.findUnique({ where: { id } });
    return row ? mapTransaction(row) : null;
  }

  async function listAccounts() {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, currency: true, balance: true, createdAt: true }
    });
    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency.trim(),
      balance: Number(account.balance),
      created_at: account.createdAt
    }));
  }

  async function listAccountHistory(accountId) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { transaction: true }
    });
    return entries.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      amount: Number(entry.amount),
      currency: entry.transaction.currency.trim(),
      description: entry.transaction.description,
      counterpartyAccountId: entry.transaction.sourceAccountId === accountId
        ? entry.transaction.destinationAccountId
        : entry.transaction.sourceAccountId,
      createdAt: entry.createdAt
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

function mapTransaction(row) {
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

module.exports = { createLedgerService };
