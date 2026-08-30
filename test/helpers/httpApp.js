require('reflect-metadata');

const path = require('node:path');
const { Test } = require('@nestjs/testing');
const { LedgerController } = require('../../dist/http/ledger.controller');
const { LedgerService } = require('../../dist/ledger/ledger.service');
const { BrokerService } = require('../../dist/broker/broker.service');
const { DomainExceptionFilter } = require('../../dist/http/domain-exception.filter');
const { HEALTH_CHECK } = require('../../dist/tokens');

let nestApp;

async function createHttpApp({ ledgerService, publishTransfer, healthCheck }) {
  const moduleRef = await Test.createTestingModule({
    controllers: [LedgerController],
    providers: [
      { provide: LedgerService, useValue: ledgerService },
      { provide: BrokerService, useValue: { publishTransfer } },
      { provide: HEALTH_CHECK, useValue: healthCheck }
    ]
  }).compile();

  nestApp = moduleRef.createNestApplication({ logger: false });
  nestApp.useGlobalFilters(new DomainExceptionFilter());
  nestApp.useStaticAssets(path.join(__dirname, '..', '..', 'public'));
  await nestApp.init();
  return nestApp.getHttpServer();
}

async function closeHttpApp() {
  if (nestApp) await nestApp.close();
  nestApp = undefined;
}

module.exports = { createHttpApp, closeHttpApp };
