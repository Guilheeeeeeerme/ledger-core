import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { createBroker } from './broker';
import { createLedgerService } from './ledgerService';

async function waitFor<T>(name: string, operation: () => Promise<T>, attempts = 30): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`[ledger] waiting for ${name} (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Waiting for ${name} failed`);
}

async function applySchema(prisma: PrismaClient, sql: string) {
  const statements = sql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const stack = process.env.STACK_NAME || 'nestjs-prisma-bullmq';
  console.log(`[ledger] startup stack=${stack} port=${port}`);
  const prisma = new PrismaClient();
  const schema = await readFile(join(process.cwd(), 'src', 'schema.sql'), 'utf8');
  await waitFor('PostgreSQL', async () => {
    await applySchema(prisma, schema);
  });
  console.log('[ledger] db ready');

  const ledgerService = createLedgerService(prisma);
  const { publishTransfer, startWorker, closeBroker } = createBroker(ledgerService);
  await waitFor('Redis', startWorker);

  const app = await createApp({
    ledgerService,
    publishTransfer,
    healthCheck: () => prisma.$queryRaw`SELECT 1`
  });
  const server = app.listen(port, () => console.log(`[ledger] listening port=${port}`));

  async function shutdown() {
    server.close();
    await closeBroker();
    await prisma.$disconnect();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error(`[ledger] startup failed error=${(error as Error).message}`);
  process.exit(1);
});
