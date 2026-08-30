const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { LedgerService } = require('../dist/ledger/ledger.service');

const transaction = {
  id: '11111111-1111-4111-8111-111111111111',
  source_account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  destination_account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  amount: '2500',
  currency: 'BRL',
  status: 'pending'
};

function createPrisma({ existing = transaction, accounts, failOnEntries = false } = {}) {
  const queries = [];
  let committed = false;
  let rolledBack = false;

  const client = {
    async $queryRawUnsafe(sql, ...params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FROM transactions') && sql.includes('FOR UPDATE')) {
        return existing ? [existing] : [];
      }
      if (sql.includes('FROM accounts') && sql.includes('FOR UPDATE')) {
        return accounts || [
          { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
          { id: transaction.source_account_id, currency: 'BRL', balance: '10000' }
        ];
      }
      if (sql.includes("SET status = 'completed'")) {
        return [{ ...transaction, status: 'completed' }];
      }
      return [];
    },
    async $executeRawUnsafe(sql, ...params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (failOnEntries && sql.includes('INSERT INTO ledger_entries')) {
        throw new Error('database unavailable');
      }
      return 1;
    }
  };

  return {
    queries,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async $transaction(callback) {
      try {
        const result = await callback(client);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
    $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
    $executeRawUnsafe: client.$executeRawUnsafe.bind(client)
  };
}

describe('LedgerService.processTransfer', () => {
  it('locks sorted accounts and writes balanced entries', async () => {
    const prisma = createPrisma();
    const service = new LedgerService(prisma);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(prisma.committed, true);
    const accountLock = prisma.queries.find((query) => query.sql.includes('FROM accounts'));
    assert.deepEqual(accountLock.params, [[
      transaction.destination_account_id,
      transaction.source_account_id
    ]]);
    const entries = prisma.queries.find((query) => query.sql.includes('INSERT INTO ledger_entries'));
    assert.deepEqual(entries.params, [
      transaction.id,
      transaction.source_account_id,
      -2500,
      transaction.destination_account_id,
      2500
    ]);
    const balanceUpdate = prisma.queries.find((query) => query.sql.includes('UPDATE accounts'));
    assert.match(balanceUpdate.sql, /\$3::bigint/);
    assert.match(balanceUpdate.sql, /\$4::bigint/);
  });

  it('does not mutate a completed transaction again', async () => {
    const prisma = createPrisma({ existing: { ...transaction, status: 'completed' } });
    const service = new LedgerService(prisma);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(prisma.queries.some((query) => query.sql.includes('INSERT INTO ledger_entries')), false);
  });

  it('rejects insufficient funds without writing entries', async () => {
    const prisma = createPrisma({ accounts: [
      { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
      { id: transaction.source_account_id, currency: 'BRL', balance: '1000' }
    ] });
    const service = new LedgerService(prisma);

    await assert.rejects(
      () => service.processTransfer(transaction.id),
      (error) => error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(prisma.rolledBack, true);
    assert.equal(prisma.queries.some((query) => query.sql.includes('INSERT INTO ledger_entries')), false);
  });

  it('rolls back when persistence fails', async () => {
    const prisma = createPrisma({ failOnEntries: true });
    const service = new LedgerService(prisma);

    await assert.rejects(() => service.processTransfer(transaction.id));
    assert.equal(prisma.rolledBack, true);
    assert.equal(prisma.committed, false);
  });
});
