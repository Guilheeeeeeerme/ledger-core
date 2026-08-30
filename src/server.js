const fs = require('node:fs/promises');
const path = require('node:path');
const { prisma, applySchema } = require('./db');
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
      console.log(`Waiting for ${name} (${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function start() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  // Schema statements and seed inserts are idempotent, so every container start is safe.
  await waitFor('PostgreSQL', () => applySchema(schema));
  const channel = await waitFor('RabbitMQ', connectBroker);
  const ledgerService = createLedgerService(prisma);
  await startConsumer(channel, ledgerService);

  const app = createApp({
    ledgerService,
    publishTransfer,
    healthCheck: () => prisma.$queryRaw`SELECT 1`
  });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`Ledger listening on http://localhost:${port}`));

  async function shutdown() {
    server.close();
    await closeBroker();
    await prisma.$disconnect();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
