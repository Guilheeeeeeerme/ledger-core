const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

const { createLedgerService } = require('../src/ledgerService');

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  destinationAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  amount: '2500',
  currency: 'BRL',
  status: 'pending',
  description: '',
  errorCode: null,
  createdAt: new Date(),
  processedAt: null
};

function createDb({ existing = transaction, accounts, failOnEntries = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;

  function accountModels() {
    return (accounts || [
      { id: transaction.destinationAccountId, currency: 'BRL', balance: '1000' },
      { id: transaction.sourceAccountId, currency: 'BRL', balance: '10000' }
    ]).map((account) => ({
      ...account,
      async decrement(field, { by }) {
        calls.push({ op: 'decrement', id: account.id, field, by });
      },
      async increment(field, { by }) {
        calls.push({ op: 'increment', id: account.id, field, by });
      }
    }));
  }

  const Transaction = {
    async findByPk(id, opts = {}) {
      calls.push({
        op: 'findByPk',
        model: 'Transaction',
        id,
        lock: Boolean(opts.lock)
      });
      if (!existing) return null;
      const row = {
        ...existing,
        async update(values) {
          calls.push({ op: 'update', model: 'Transaction', values });
          Object.assign(row, values);
        }
      };
      return row;
    }
  };

  const Account = {
    async findAll(opts = {}) {
      calls.push({
        op: 'findAll',
        model: 'Account',
        whereIds: opts.where?.id?.[Op.in],
        order: opts.order,
        lock: Boolean(opts.lock)
      });
      return accountModels();
    }
  };

  const LedgerEntry = {
    async bulkCreate(rows) {
      calls.push({ op: 'bulkCreate', model: 'LedgerEntry', rows });
      if (failOnEntries) throw new Error('database unavailable');
      return rows;
    }
  };

  return {
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    Account,
    Transaction,
    LedgerEntry,
    async withTransaction(callback) {
      const t = { LOCK: { UPDATE: 'UPDATE' } };
      try {
        const result = await callback(t);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }
  };
}

describe('ledgerService.processTransfer', () => {
  it('locks sorted accounts and writes balanced entries', async () => {
    const db = createDb();
    const service = createLedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.committed, true);

    const accountLock = db.calls.find((call) => call.op === 'findAll' && call.model === 'Account');
    assert.equal(accountLock.lock, true);
    assert.deepEqual(accountLock.whereIds, [
      transaction.destinationAccountId,
      transaction.sourceAccountId
    ]);
    assert.deepEqual(accountLock.order, [['id', 'ASC']]);

    const entries = db.calls.find((call) => call.op === 'bulkCreate');
    assert.deepEqual(entries.rows, [
      { transactionId: transaction.id, accountId: transaction.sourceAccountId, amount: -2500 },
      { transactionId: transaction.id, accountId: transaction.destinationAccountId, amount: 2500 }
    ]);

    assert.equal(
      db.calls.some((call) => call.op === 'decrement' && call.id === transaction.sourceAccountId && call.by === 2500),
      true
    );
    assert.equal(
      db.calls.some((call) => call.op === 'increment' && call.id === transaction.destinationAccountId && call.by === 2500),
      true
    );
  });

  it('does not mutate a completed transaction again', async () => {
    const db = createDb({ existing: { ...transaction, status: 'completed' } });
    const service = createLedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.calls.some((call) => call.op === 'bulkCreate'), false);
  });

  it('rejects insufficient funds without writing entries', async () => {
    const db = createDb({ accounts: [
      { id: transaction.destinationAccountId, currency: 'BRL', balance: '1000' },
      { id: transaction.sourceAccountId, currency: 'BRL', balance: '1000' }
    ] });
    const service = createLedgerService(db);

    await assert.rejects(
      () => service.processTransfer(transaction.id),
      (error) => error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(db.rolledBack, true);
    assert.equal(db.calls.some((call) => call.op === 'bulkCreate'), false);
  });

  it('rolls back when persistence fails', async () => {
    const db = createDb({ failOnEntries: true });
    const service = createLedgerService(db);

    await assert.rejects(() => service.processTransfer(transaction.id));
    assert.equal(db.rolledBack, true);
    assert.equal(db.committed, false);
  });
});
