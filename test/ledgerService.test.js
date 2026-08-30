const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createLedgerService } = require('../src/ledgerService');

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  source_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  destination_account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  amount: '2500',
  currency: 'BRL',
  status: 'pending'
};

function createDb({ existing = transaction, accounts, failOnEntries = false } = {}) {
  const queries = [];
  let committed = false;
  let rolledBack = false;

  const client = {
    async query(sql, params = []) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FROM transactions') && sql.includes('FOR UPDATE')) {
        return { rows: existing ? [existing] : [] };
      }
      if (sql.includes('FROM accounts') && sql.includes('FOR UPDATE')) {
        return { rows: accounts || [
          { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
          { id: transaction.source_account_id, currency: 'BRL', balance: '10000' }
        ] };
      }
      if (failOnEntries && sql.includes('INSERT INTO ledger_entries')) {
        throw new Error('database unavailable');
      }
      if (sql.includes("SET status = 'completed'")) {
        return { rows: [{ ...transaction, status: 'completed' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };

  return {
    queries,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async withTransaction(callback) {
      try {
        const result = await callback(client);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
    query: client.query.bind(client)
  };
}

describe('ledgerService.processTransfer', () => {
  it('locks sorted accounts and writes balanced entries', async () => {
    const db = createDb();
    const service = createLedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.committed, true);
    const accountLock = db.queries.find((query) => query.sql.includes('FROM accounts'));
    assert.deepEqual(accountLock.params, [[
      transaction.destination_account_id,
      transaction.source_account_id
    ]]);
    const entries = db.queries.find((query) => query.sql.includes('INSERT INTO ledger_entries'));
    assert.deepEqual(entries.params, [
      transaction.id,
      transaction.source_account_id,
      -2500,
      transaction.destination_account_id,
      2500
    ]);
    const balanceUpdate = db.queries.find((query) => query.sql.includes('UPDATE accounts'));
    assert.match(balanceUpdate.sql, /\$3::bigint/);
    assert.match(balanceUpdate.sql, /\$4::bigint/);
  });

  it('does not mutate a completed transaction again', async () => {
    const db = createDb({ existing: { ...transaction, status: 'completed' } });
    const service = createLedgerService(db);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(db.queries.some((query) => query.sql.includes('INSERT INTO ledger_entries')), false);
  });

  it('rejects insufficient funds without writing entries', async () => {
    const db = createDb({ accounts: [
      { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
      { id: transaction.source_account_id, currency: 'BRL', balance: '1000' }
    ] });
    const service = createLedgerService(db);

    await assert.rejects(
      () => service.processTransfer(transaction.id),
      (error) => error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(db.rolledBack, true);
    assert.equal(db.queries.some((query) => query.sql.includes('INSERT INTO ledger_entries')), false);
  });

  it('rolls back when persistence fails', async () => {
    const db = createDb({ failOnEntries: true });
    const service = createLedgerService(db);

    await assert.rejects(() => service.processTransfer(transaction.id));
    assert.equal(db.rolledBack, true);
    assert.equal(db.committed, false);
  });
});
