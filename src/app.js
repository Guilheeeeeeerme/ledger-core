const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { DomainError } = require('./domain/validateTransfer');

function createApp({ ledgerService, publishTransfer, healthCheck }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', async (_request, response, next) => {
    try {
      await healthCheck();
      response.json({ status: 'ok', stack: process.env.STACK_NAME || 'raw' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/accounts', async (_request, response, next) => {
    try {
      response.json({ accounts: await ledgerService.listAccounts() });
    } catch (error) { next(error); }
  });

  app.get('/api/accounts/:id/transactions', async (request, response, next) => {
    try {
      response.json({ transactions: await ledgerService.listAccountHistory(request.params.id) });
    } catch (error) { next(error); }
  });

  app.get('/api/transactions/:id', async (request, response, next) => {
    try {
      const transaction = await ledgerService.getTransaction(request.params.id);
      if (!transaction) return response.status(404).json({
        error: { code: 'TRANSACTION_NOT_FOUND', message: 'transaction not found' }
      });
      response.json(transaction);
    } catch (error) { next(error); }
  });

  app.post('/api/transactions', async (request, response, next) => {
    try {
      const input = {
        ...request.body,
        transactionId: request.body.transactionId || crypto.randomUUID()
      };
      // Persist pending first: if publish fails, the request can safely retry with the same ID.
      const transaction = await ledgerService.createPendingTransfer(input);
      if (transaction.status === 'pending') await publishTransfer(transaction.id);
      console.log(`[ledger] POST /api/transactions accepted id=${transaction.id}`);
      response.status(202).json(transaction);
    } catch (error) {
      if (error instanceof DomainError) {
        console.log(`[ledger] POST /api/transactions rejected code=${error.code} id=${request.body?.transactionId || '-'}`);
      }
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof DomainError) {
      return response.status(error.status).json({
        error: { code: error.code, message: error.message }
      });
    }
    console.error(`[ledger] internal error message=${error.message}`);
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' }
    });
  });

  return app;
}

module.exports = { createApp };
