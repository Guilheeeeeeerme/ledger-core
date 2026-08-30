import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './http/domain-exception.filter';

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
  throw new Error(`${name} unavailable`);
}

async function applySchema() {
  const connectionString = process.env.DATABASE_URL || 'postgres://ledger:ledger@localhost:5432/ledger';
  const schema = await readFile(join(__dirname, 'schema.sql'), 'utf8');

  await waitFor('PostgreSQL', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(schema);
    } finally {
      await client.end();
    }
  });
}

async function bootstrap() {
  await applySchema();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  console.log(`Ledger listening on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
