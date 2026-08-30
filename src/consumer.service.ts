import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerService } from './broker/broker.service';
import { LedgerService } from './ledger/ledger.service';
import { startConsumer } from './consumer';

@Injectable()
export class TransferConsumer implements OnModuleInit {
  constructor(
    private readonly brokerService: BrokerService,
    private readonly ledgerService: LedgerService
  ) {}

  async onModuleInit() {
    const channel = await this.brokerService.connect();
    await startConsumer(channel, this.ledgerService);
  }
}
