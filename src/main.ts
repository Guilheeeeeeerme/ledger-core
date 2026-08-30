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
      console.log(`[ledger] waiting for ${name} (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Failed waiting for ${name}`);
}

async function bootstrap() {
  const port = Number(process.env.PORT || 3000);
  const stack = process.env.STACK_NAME || 'nestjs-prisma-kafka';
  console.log(`[ledger] startup stack=${stack} port=${port}`);
  const app = await createProductionApp();
  const prisma = app.get(PrismaService);
  const kafka = app.get(KafkaService);
  const ledgerService = app.get(LedgerService);

  await waitFor('PostgreSQL', () => prisma.ensureSchema());
  console.log('[ledger] db ready');
  await waitFor('Kafka', () => kafka.connectProducer());

  const consumer = await waitFor('Kafka consumer', () => kafka.createConsumer());
  // Start consuming without blocking listen.
  void startConsumer(consumer, ledgerService);
  console.log(`[ledger] consumer started topic=${kafka.topic}`);

  await app.listen(port);
  console.log(`[ledger] listening port=${port}`);

  const shutdown = async () => {
    await app.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  console.error(`[ledger] startup failed error=${(error as Error).message}`);
  process.exit(1);
});
