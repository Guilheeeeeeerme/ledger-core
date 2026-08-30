const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { LedgerService } = require('../dist/ledger/ledger.service');

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  destinationAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  amount: '2500',
  currency: 'BRL',
  status: 'pending',
  description: '',
  errorCode: null
};

function createDataSource({ existing = transaction, accounts, failOnEntries = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;

  const manager = {
    async findOne(_entity, options) {
      calls.push({ op: 'findOne', options });
      return existing ? { ...existing } : null;
    },
    createQueryBuilder() {
      const qb = {
        where(_sql, params) {
          calls.push({ op: 'where', params });
          return qb;
        },
        orderBy(column, direction) {
          calls.push({ op: 'orderBy', column, direction });
          return qb;
        },
        setLock(mode) {
          calls.push({ op: 'setLock', mode });
          return qb;
        },
        async getMany() {
          return accounts || [
            { id: transaction.destinationAccountId, currency: 'BRL', balance: '1000' },
            { id: transaction.sourceAccountId, currency: 'BRL', balance: '10000' }
          ];
        }
      };
      return qb;
    },
    async save(target, payload) {
      const entities = payload === undefined ? target : payload;
      calls.push({ op: 'save', entities });
      if (failOnEntries && Array.isArray(entities) && entities.some((row) => row.accountId && row.amount != null)) {
        throw new Error('database unavailable');
      }
      return entities;
    }
  };

  return {
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async transaction(callback) {
      try {
        const result = await callback(manager);
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
    const db = createDataSource();
    const service = new LedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.committed, true);

    const lock = db.calls.find((call) => call.op === 'findOne');
    assert.equal(lock.options.lock.mode, 'pessimistic_write');

    const where = db.calls.find((call) => call.op === 'where');
    assert.deepEqual(where.params.ids, [
      transaction.destinationAccountId,
      transaction.sourceAccountId
    ]);

    const order = db.calls.find((call) => call.op === 'orderBy');
    assert.equal(order.column, 'account.id');
    assert.equal(order.direction, 'ASC');

    const setLock = db.calls.find((call) => call.op === 'setLock');
    assert.equal(setLock.mode, 'pessimistic_write');

    const entrySave = db.calls.find((call) => (
      call.op === 'save'
      && Array.isArray(call.entities)
      && call.entities.some((row) => row.accountId)
    ));
    const amounts = entrySave.entities.map((row) => Number(row.amount));
    assert.deepEqual(amounts, [-2500, 2500]);
    assert.equal(amounts.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(entrySave.entities[0].accountId, transaction.sourceAccountId);
    assert.equal(entrySave.entities[1].accountId, transaction.destinationAccountId);
  });

  it('does not mutate a completed transaction again', async () => {
    const db = createDataSource({ existing: { ...transaction, status: 'completed' } });
    const service = new LedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.calls.some((call) => (
      call.op === 'save' && Array.isArray(call.entities) && call.entities.some((row) => row.accountId)
    )), false);
  });

  it('rejects insufficient funds without writing entries', async () => {
    const db = createDataSource({ accounts: [
      { id: transaction.destinationAccountId, currency: 'BRL', balance: '1000' },
      { id: transaction.sourceAccountId, currency: 'BRL', balance: '1000' }
    ] });
    const service = new LedgerService(db);

    await assert.rejects(
      () => service.processTransfer(transaction.id),
      (error) => error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(db.rolledBack, true);
    assert.equal(db.calls.some((call) => (
      call.op === 'save' && Array.isArray(call.entities) && call.entities.some((row) => row.accountId)
    )), false);
  });

  it('rolls back when persistence fails', async () => {
    const db = createDataSource({ failOnEntries: true });
    const service = new LedgerService(db);

    await assert.rejects(() => service.processTransfer(transaction.id));
    assert.equal(db.rolledBack, true);
    assert.equal(db.committed, false);
  });
});
