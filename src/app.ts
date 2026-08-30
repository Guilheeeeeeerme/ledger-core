import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule, AppDeps } from './app.module';
import { DomainExceptionFilter } from './filters/domain-exception.filter';

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(deps),
    { logger: false }
  );
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.init();
  return app;
}

export async function createProductionApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  return app;
}
