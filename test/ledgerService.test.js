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

function sqlText(strings, values) {
  if (strings && typeof strings === 'object' && !Array.isArray(strings) && strings.strings) {
    return strings.strings.join(' ? ');
  }
  if (Array.isArray(strings)) return strings.join(' ? ');
  return [strings, ...values].map((part) => String(part)).join(' ');
}

function createPrisma({ existing = transaction, accounts, failOnEntries = false } = {}) {
  const queries = [];
  let committed = false;
  let rolledBack = false;

  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = sqlText(strings, values).replace(/\s+/g, ' ').trim();
      queries.push({ sql, params: values });
      if (/FROM transactions/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        return existing ? [existing] : [];
      }
      if (/FROM accounts/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        return accounts || [
          { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
          { id: transaction.source_account_id, currency: 'BRL', balance: '10000' }
        ];
      }
      if (/SET status = 'completed'/i.test(sql)) {
        return [{ ...transaction, status: 'completed' }];
      }
      return [];
    },
    async $executeRaw(strings, ...values) {
      const sql = sqlText(strings, values).replace(/\s+/g, ' ').trim();
      queries.push({ sql, params: values });
      if (failOnEntries && /INSERT INTO ledger_entries/i.test(sql)) {
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
        const result = await callback(tx);
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
    const prisma = createPrisma();
    const service = createLedgerService(prisma);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(prisma.committed, true);
    const transactionLock = prisma.queries.find((query) => /FROM transactions/i.test(query.sql) && /FOR UPDATE/i.test(query.sql));
    assert.ok(transactionLock);
    const accountLock = prisma.queries.find((query) => /FROM accounts/i.test(query.sql) && /FOR UPDATE/i.test(query.sql));
    assert.match(accountLock.sql, /ORDER BY id/i);
    assert.match(accountLock.sql, /FOR UPDATE/i);
    const sortedIds = [transaction.destination_account_id, transaction.source_account_id];
    assert.ok(
      sortedIds.every((id) => accountLock.params.some((param) => param === id || String(param).includes(id)))
      || sortedIds.every((id) => accountLock.sql.includes(id))
    );
    const entries = prisma.queries.find((query) => /INSERT INTO ledger_entries/i.test(query.sql));
    assert.ok(entries);
    assert.equal(entries.params.includes(-2500) || entries.sql.includes('-2500'), true);
    assert.equal(entries.params.includes(2500) || /[^-\d]2500/.test(` ${entries.sql} ${entries.params.join(' ')}`), true);
  });

  it('does not mutate a completed transaction again', async () => {
    const prisma = createPrisma({ existing: { ...transaction, status: 'completed' } });
    const service = createLedgerService(prisma);

    const result = await service.processTransfer(transaction.id);

    assert.equal(result.status, 'completed');
    assert.equal(prisma.queries.some((query) => /INSERT INTO ledger_entries/i.test(query.sql)), false);
  });

  it('rejects insufficient funds without writing entries', async () => {
    const prisma = createPrisma({ accounts: [
      { id: transaction.destination_account_id, currency: 'BRL', balance: '1000' },
      { id: transaction.source_account_id, currency: 'BRL', balance: '1000' }
    ] });
    const service = createLedgerService(prisma);

    await assert.rejects(
      () => service.processTransfer(transaction.id),
      (error) => error.code === 'INSUFFICIENT_FUNDS'
    );
    assert.equal(prisma.rolledBack, true);
    assert.equal(prisma.queries.some((query) => /INSERT INTO ledger_entries/i.test(query.sql)), false);
  });

  it('rolls back when persistence fails', async () => {
    const prisma = createPrisma({ failOnEntries: true });
    const service = createLedgerService(prisma);

    await assert.rejects(() => service.processTransfer(transaction.id));
    assert.equal(prisma.rolledBack, true);
    assert.equal(prisma.committed, false);
  });
});
