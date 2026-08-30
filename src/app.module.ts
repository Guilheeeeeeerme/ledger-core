import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BrokerService } from './broker/broker.service';
import { TransferConsumer } from './consumer.service';
import { Account } from './entities/account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerTransaction } from './entities/transaction.entity';
import { DomainExceptionFilter } from './http/domain-exception.filter';
import { LedgerController } from './http/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { HEALTH_CHECK } from './tokens';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://ledger:ledger@localhost:5432/ledger',
      entities: [Account, LedgerTransaction, LedgerEntry],
      synchronize: false,
      retryAttempts: 30,
      retryDelay: 1000
    })
  ],
  controllers: [LedgerController],
  providers: [
    LedgerService,
    BrokerService,
    TransferConsumer,
    DomainExceptionFilter,
    {
      provide: HEALTH_CHECK,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => () => dataSource.query('SELECT 1')
    }
  ]
})
export class AppModule {}
