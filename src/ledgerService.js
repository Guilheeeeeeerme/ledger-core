const { DomainError, validateTransfer } = require('./domain/validateTransfer');
const { Op } = require('sequelize');

/**
 * Creates the domain boundary used by both HTTP routes and broker delivery.
 * The injected Sequelize models keep accounting policy independently testable.
 */
function createLedgerService({ Account, Transaction, LedgerEntry, withTransaction }) {
  async function createPendingTransfer(input) {
    const transfer = validateTransfer(input);
    const [row, created] = await Transaction.findOrCreate({
      where: { id: transfer.transactionId },
      defaults: {
        id: transfer.transactionId,
        sourceAccountId: transfer.sourceAccountId,
        destinationAccountId: transfer.destinationAccountId,
        amount: transfer.amount,
        currency: transfer.currency,
        description: transfer.description,
        status: 'pending'
      }
    });

    if (created) {
      const mapped = mapTransaction(row);
      console.log(`[ledger] persist pending new id=${mapped.id}`);
      return mapped;
    }

    const existing = mapTransaction(row);
    const samePayload = existing.sourceAccountId === transfer.sourceAccountId
      && existing.destinationAccountId === transfer.destinationAccountId
      && existing.amount === transfer.amount
      && existing.currency === transfer.currency;

    if (!samePayload) {
      console.log(`[ledger] persist pending conflict id=${transfer.transactionId}`);
      throw new DomainError('TRANSACTION_CONFLICT', 'transactionId already has another payload', 409);
    }
    console.log(`[ledger] persist pending existing id=${existing.id} status=${existing.status}`);
    return existing;
  }

  /**
   * Applies one pending transfer exactly once. All financial mutations occur
   * inside the Sequelize transaction supplied by the database adapter.
   */
  async function processTransfer(transactionId) {
    return withTransaction(async (t) => {
      const transaction = await Transaction.findByPk(transactionId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      console.log(`[ledger] processTransfer lock transaction id=${transactionId}`);

      if (!transaction) {
        console.log(`[ledger] processTransfer fail code=TRANSACTION_NOT_FOUND id=${transactionId}`);
        throw new DomainError('TRANSACTION_NOT_FOUND', 'transaction not found', 404);
      }
      // A redelivered broker message becomes a no-op after the first commit.
      if (transaction.status !== 'pending') {
        console.log(`[ledger] processTransfer skip not pending id=${transaction.id} status=${transaction.status}`);
        return mapTransaction(transaction);
      }

      // Stable lock ordering prevents opposite transfers from deadlocking each other.
      const accountIds = [transaction.sourceAccountId, transaction.destinationAccountId].sort();
      console.log(`[ledger] processTransfer lock accounts source=${transaction.sourceAccountId} dest=${transaction.destinationAccountId}`);
      const accountRows = await Account.findAll({
        where: { id: { [Op.in]: accountIds } },
        order: [['id', 'ASC']],
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (accountRows.length !== 2) {
        console.log(`[ledger] processTransfer fail code=ACCOUNT_NOT_FOUND id=${transaction.id}`);
        throw new DomainError('ACCOUNT_NOT_FOUND', 'source or destination account not found', 404);
      }

      const accounts = new Map(accountRows.map((account) => [account.id, account]));
      const source = accounts.get(transaction.sourceAccountId);
      const destination = accounts.get(transaction.destinationAccountId);
      const amount = Number(transaction.amount);

      if (source.currency.trim() !== transaction.currency.trim()
        || destination.currency.trim() !== transaction.currency.trim()) {
        console.log(`[ledger] processTransfer fail code=CURRENCY_MISMATCH id=${transaction.id}`);
        throw new DomainError('CURRENCY_MISMATCH', 'accounts must use the transaction currency', 409);
      }
      if (Number(source.balance) < amount) {
        console.log(`[ledger] processTransfer fail code=INSUFFICIENT_FUNDS id=${transaction.id}`);
        throw new DomainError('INSUFFICIENT_FUNDS', 'source account has insufficient funds', 409);
      }

      // Both entries live in the same DB transaction; partial money movement cannot commit.
      await LedgerEntry.bulkCreate([
        { transactionId: transaction.id, accountId: source.id, amount: -amount },
        { transactionId: transaction.id, accountId: destination.id, amount }
      ], { transaction: t });
      console.log(`[ledger] processTransfer write entries id=${transaction.id}`);

      await source.decrement('balance', { by: amount, transaction: t });
      await destination.increment('balance', { by: amount, transaction: t });
      console.log(`[ledger] processTransfer balances updated id=${transaction.id}`);

      await transaction.update({
        status: 'completed',
        processedAt: new Date(),
        errorCode: null
      }, { transaction: t });
      console.log(`[ledger] processTransfer completed id=${transaction.id}`);

      return mapTransaction(transaction);
    });
  }

  async function markFailed(id, code) {
    const [count, rows] = await Transaction.update(
      {
        status: 'failed',
        errorCode: code,
        processedAt: new Date()
      },
      {
        where: { id, status: 'pending' },
        returning: true
      }
    );
    if (count > 0 && rows[0]) return mapTransaction(rows[0]);
    return getTransaction(id);
  }

  async function getTransaction(id) {
    const row = await Transaction.findByPk(id);
    return row ? mapTransaction(row) : null;
  }

  async function listAccounts() {
    const rows = await Account.findAll({ order: [['name', 'ASC']] });
    return rows.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency.trim(),
      balance: Number(account.balance),
      created_at: account.createdAt
    }));
  }

  async function listAccountHistory(accountId) {
    const rows = await LedgerEntry.findAll({
      where: { accountId },
      include: [{
        model: Transaction,
        required: true,
        attributes: [
          'description',
          'currency',
          'sourceAccountId',
          'destinationAccountId'
        ]
      }],
      order: [['createdAt', 'DESC']]
    });

    return rows.map((entry) => {
      const tx = entry.Transaction;
      const counterpartyAccountId = tx.sourceAccountId === accountId
        ? tx.destinationAccountId
        : tx.sourceAccountId;
      return {
        id: entry.id,
        transactionId: entry.transactionId,
        amount: Number(entry.amount),
        currency: tx.currency.trim(),
        description: tx.description,
        counterpartyAccountId,
        createdAt: entry.createdAt
      };
    });
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
  const data = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  return {
    id: data.id,
    sourceAccountId: data.sourceAccountId ?? data.source_account_id,
    destinationAccountId: data.destinationAccountId ?? data.destination_account_id,
    amount: Number(data.amount),
    currency: String(data.currency).trim(),
    description: data.description,
    status: data.status,
    errorCode: data.errorCode ?? data.error_code ?? null,
    createdAt: data.createdAt ?? data.created_at,
    processedAt: data.processedAt ?? data.processed_at ?? null
  };
}

module.exports = { createLedgerService };
