import { Module, DynamicModule } from '@nestjs/common';
import { LedgerController, PUBLISH_TRANSFER, HEALTH_CHECK } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { PrismaService } from './prisma/prisma.service';
import { KafkaService } from './broker/kafka.service';

export type AppDeps = {
  ledgerService: Pick<
    LedgerService,
    'createPendingTransfer' | 'getTransaction' | 'listAccounts' | 'listAccountHistory' | 'processTransfer' | 'markFailed'
  >;
  publishTransfer: (transactionId: string) => Promise<void>;
  healthCheck: () => Promise<unknown>;
};

@Module({})
export class AppModule {
  static register(deps?: AppDeps): DynamicModule {
    if (deps) {
      return {
        module: AppModule,
        controllers: [LedgerController],
        providers: [
          { provide: LedgerService, useValue: deps.ledgerService },
          { provide: PUBLISH_TRANSFER, useValue: deps.publishTransfer },
          { provide: HEALTH_CHECK, useValue: deps.healthCheck }
        ]
      };
    }

    return {
      module: AppModule,
      controllers: [LedgerController],
      providers: [
        PrismaService,
        LedgerService,
        KafkaService,
        {
          provide: PUBLISH_TRANSFER,
          useFactory: (kafka: KafkaService) => (id: string) => kafka.publishTransfer(id),
          inject: [KafkaService]
        },
        {
          provide: HEALTH_CHECK,
          useFactory: (prisma: PrismaService) => () => prisma.$queryRawUnsafe('SELECT 1'),
          inject: [PrismaService]
        }
      ],
      exports: [PrismaService, LedgerService, KafkaService]
    };
  }
}
