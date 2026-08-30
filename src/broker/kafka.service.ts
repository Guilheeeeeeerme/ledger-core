import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Admin, Consumer, Kafka, Producer, logLevel } from 'kafkajs';

const TOPIC = process.env.KAFKA_TOPIC || 'ledger.transfers.kafka';
const GROUP_ID = process.env.KAFKA_GROUP_ID || 'ledger-kafka';

function brokers() {
  return (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((value) => value.trim());
}

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private kafka = new Kafka({
    clientId: 'ledger-nestjs-prisma-kafka',
    brokers: brokers(),
    logLevel: logLevel.ERROR
  });

  private producer: Producer | undefined;
  private consumer: Consumer | undefined;
  private admin: Admin | undefined;

  get topic() {
    return TOPIC;
  }

  get groupId() {
    return GROUP_ID;
  }

  async connectProducer() {
    if (this.producer) return this.producer;
    this.admin = this.kafka.admin();
    await this.admin.connect();
    await this.admin.createTopics({
      topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: true
    });
    this.producer = this.kafka.producer();
    await this.producer.connect();
    return this.producer;
  }

  async publishTransfer(transactionId: string) {
    const producer = await this.connectProducer();
    await producer.send({
      topic: TOPIC,
      messages: [{
        key: transactionId,
        value: JSON.stringify({ transactionId })
      }]
    });
  }

  async createConsumer() {
    if (this.consumer) return this.consumer;
    this.consumer = this.kafka.consumer({ groupId: GROUP_ID });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    return this.consumer;
  }

  async onModuleDestroy() {
    if (this.consumer) await this.consumer.disconnect();
    if (this.producer) await this.producer.disconnect();
    if (this.admin) await this.admin.disconnect();
  }
}

export { TOPIC, GROUP_ID };
