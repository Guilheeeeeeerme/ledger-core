const { DomainError, validateTransfer } = require('./domain/validateTransfer');

/**
 * Creates the domain boundary used by both HTTP routes and broker delivery.
 * The injected database adapter keeps accounting policy independently testable.
 */
function createLedgerService(db) {
  async function createPendingTransfer(input) {
    const transfer = validateTransfer(input);
    const inserted = await db.query(
      `INSERT INTO transactions
        (id, source_account_id, destination_account_id, amount, currency, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        transfer.transactionId,
        transfer.sourceAccountId,
        transfer.destinationAccountId,
        transfer.amount,
        transfer.currency,
        transfer.description
      ]
    );

    if (inserted.rowCount === 1) return mapTransaction(inserted.rows[0]);

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
   * inside the transaction supplied by the database adapter.
   */
  async function processTransfer(transactionId) {
    return db.withTransaction(async (client) => {
      const transactionResult = await client.query(
        'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
        [transactionId]
      );
      const transaction = transactionResult.rows[0];

      if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      // A redelivered broker message becomes a no-op after the first commit.
      if (transaction.status !== 'pending') return mapTransaction(transaction);

      // Stable lock ordering prevents opposite transfers from deadlocking each other.
      const accountIds = [transaction.source_account_id, transaction.destination_account_id].sort();
      const accountResult = await client.query(
        'SELECT id, currency, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [accountIds]
      );

      if (accountResult.rows.length !== 2) {
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const accounts = new Map(accountResult.rows.map((account) => [account.id, account]));
      const source = accounts.get(transaction.source_account_id);
      const destination = accounts.get(transaction.destination_account_id);
      const amount = Number(transaction.amount);

      if (source.currency.trim() !== transaction.currency.trim()
        || destination.currency.trim() !== transaction.currency.trim()) {
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      // Both entries live in the same DB transaction; partial money movement cannot commit.
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, amount)
         VALUES ($1, $2, $3), ($1, $4, $5)`,
        [transaction.id, source.id, -amount, destination.id, amount]
      );
      await client.query(
        `UPDATE accounts
         SET balance = balance + CASE WHEN id = $1 THEN $3::bigint ELSE $4::bigint END
         WHERE id IN ($1, $2)`,
        [source.id, destination.id, -amount, amount]
      );
      const completed = await client.query(
        `UPDATE transactions
         SET status = 'completed', processed_at = NOW(), error_code = NULL
         WHERE id = $1 RETURNING *`,
        [transaction.id]
      );
      return mapTransaction(completed.rows[0]);
    });
  }

  async function markFailed(id, code) {
    const result = await db.query(
      `UPDATE transactions SET status = 'failed', error_code = $2, processed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, code]
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : getTransaction(id);
  }

  async function getTransaction(id) {
    const result = await db.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  async function listAccounts() {
    const result = await db.query(
      'SELECT id, name, currency, balance, created_at FROM accounts ORDER BY name'
    );
    return result.rows.map((account) => ({
      ...account,
      currency: account.currency.trim(),
      balance: Number(account.balance)
    }));
  }

  async function listAccountHistory(accountId) {
    const result = await db.query(
      `SELECT e.id, e.transaction_id, e.amount, e.created_at, t.description, t.currency,
              CASE WHEN t.source_account_id = $1 THEN t.destination_account_id
                   ELSE t.source_account_id END AS counterparty_account_id
       FROM ledger_entries e
       JOIN transactions t ON t.id = e.transaction_id
       WHERE e.account_id = $1
       ORDER BY e.created_at DESC`,
      [accountId]
    );
    return result.rows.map((entry) => ({
      id: entry.id,
      transactionId: entry.transaction_id,
      amount: Number(entry.amount),
      currency: entry.currency.trim(),
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

function mapTransaction(row) {
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

module.exports = { createLedgerService };
