const db = require('./db');
const { createLedgerService } = require('./ledgerService');
const { connectBroker, publishTransfer, closeBroker } = require('./broker');
const { startConsumer } = require('./consumer');
const { createApp } = require('./app');

async function waitFor(name, operation, attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`[ledger] waiting for ${name} (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const stack = process.env.STACK_NAME || 'express-sequelize-rabbitmq';
  console.log(`[ledger] startup stack=${stack} port=${port}`);
  // Model sync and seed inserts are idempotent, so every container start is safe.
  await waitFor('PostgreSQL', () => db.prepareDatabase());
  console.log('[ledger] db ready');
  const channel = await waitFor('RabbitMQ', connectBroker);
  console.log('[ledger] broker ready');
  const ledgerService = createLedgerService(db);
  await startConsumer(channel, ledgerService);

  const app = createApp({
    ledgerService,
    publishTransfer,
    healthCheck: () => db.healthCheck()
  });
  const server = app.listen(port, () => console.log(`[ledger] listening port=${port}`));

  async function shutdown() {
    server.close();
    await closeBroker();
    await db.close();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error(`[ledger] startup failed error=${error.message}`);
  process.exit(1);
});
