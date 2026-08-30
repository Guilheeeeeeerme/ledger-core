const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createHttpApp } = require('./helpers/httpApp');
const { validateTransfer } = require('../dist/domain/validateTransfer');

describe('ledger API', () => {
  let app;
  const published = [];
  const service = {
    async createPendingTransfer(input) {
      const valid = validateTransfer(input);
      return { id: valid.transactionId, ...valid, status: 'pending' };
    },
    async getTransaction(id) {
      return id === '11111111-1111-4111-8111-111111111111'
        ? { id, status: 'completed' }
        : null;
    },
    async listAccounts() {
      return [{ id: 'a', name: 'Alice', balance: 100000, currency: 'BRL' }];
    },
    async listAccountHistory() {
      return [{ transactionId: 'tx', amount: -2500 }];
    }
  };

  before(async () => {
    app = await createHttpApp({
      ledgerService: service,
      publishTransfer: async (id) => { published.push(id); },
      healthCheck: async () => true
    });
  });

  it('reports health with the configured stack name', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'ok',
      stack: process.env.STACK_NAME || 'nestjs-prisma-kafka'
    });
  });

  it('accepts and publishes a valid transfer', async () => {
    const input = {
      transactionId: '11111111-1111-4111-8111-111111111111',
      sourceAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      destinationAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      amount: 2500,
      currency: 'BRL'
    };
    const response = await request(app).post('/api/transactions').send(input);

    assert.equal(response.status, 202);
    assert.equal(response.body.status, 'pending');
    assert.deepEqual(published, [input.transactionId]);
  });

  it('returns structured validation errors', async () => {
    const response = await request(app).post('/api/transactions').send({ amount: 0 });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_INPUT');
  });

  it('lists accounts and history', async () => {
    const accounts = await request(app).get('/api/accounts');
    const history = await request(app).get('/api/accounts/a/transactions');
    assert.equal(accounts.body.accounts[0].balance, 100000);
    assert.equal(history.body.transactions[0].amount, -2500);
  });

  it('returns 404 for an unknown transaction', async () => {
    const response = await request(app).get('/api/transactions/unknown');
    assert.equal(response.status, 404);
  });

  it('serves the dashboard and its browser script', async () => {
    const page = await request(app).get('/');
    const script = await request(app).get('/app.js');
    assert.equal(page.status, 200);
    assert.match(page.text, /Ledger Flow/);
    assert.match(page.text, /New transfer/);
    assert.match(page.text, /Transaction history/);
    assert.equal(script.status, 200);
  });
});
