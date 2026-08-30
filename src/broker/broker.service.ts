import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqp, { Channel, ChannelModel } from 'amqplib';
import { QUEUE_NAME } from '../tokens';

@Injectable()
export class BrokerService implements OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;
  readonly queue = QUEUE_NAME;

  async connect(): Promise<Channel> {
    if (this.channel) return this.channel;
    const url = process.env.RABBITMQ_URL || 'amqp://ledger:ledger@localhost:5672';

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        this.connection = await amqp.connect(url);
        this.channel = await this.connection.createChannel();
        await this.channel.assertQueue(this.queue, { durable: true });
        this.connection.on('close', () => {
          this.channel = undefined;
          this.connection = undefined;
        });
        console.log('[ledger] broker ready');
        return this.channel;
      } catch (error) {
        if (attempt === 30) throw error;
        console.log(`[ledger] waiting for RabbitMQ (${attempt}/30)`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error('RabbitMQ connection failed');
  }

  async publishTransfer(transactionId: string) {
    const channel = await this.connect();
    channel.sendToQueue(
      this.queue,
      Buffer.from(JSON.stringify({ transactionId })),
      { persistent: true, contentType: 'application/json' }
    );
    console.log(`[ledger] publish queue=${this.queue} id=${transactionId}`);
  }

  async onModuleDestroy() {
    if (this.connection) await this.connection.close();
  }
}
