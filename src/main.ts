import 'reflect-metadata';
import { createProductionApp } from './app';
import { KafkaService } from './broker/kafka.service';
import { LedgerService } from './ledger/ledger.service';
import { PrismaService } from './prisma/prisma.service';
import { startConsumer } from './consumer/transfer.consumer';

async function waitFor<T>(name: string, operation: () => Promise<T>, attempts = 30): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`Waiting for ${name} (${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Failed waiting for ${name}`);
}

async function bootstrap() {
  const app = await createProductionApp();
  const prisma = app.get(PrismaService);
  const kafka = app.get(KafkaService);
  const ledgerService = app.get(LedgerService);

  await waitFor('PostgreSQL', () => prisma.ensureSchema());
  await waitFor('Kafka', () => kafka.connectProducer());

  const consumer = await waitFor('Kafka consumer', () => kafka.createConsumer());
  // Start consuming without blocking listen.
  void startConsumer(consumer, ledgerService);

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  console.log(`Ledger listening on http://localhost:${port}`);

  const shutdown = async () => {
    await app.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
