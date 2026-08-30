import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { processTransferJob } from './consumer';
import type { LedgerService } from './ledgerService';

const QUEUE = process.env.QUEUE_NAME || process.env.BULLMQ_QUEUE || 'ledger.bullmq';

function prefetchCount() {
  const parsed = Number(process.env.PREFETCH);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function redisConnection() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return new IORedis(url, { maxRetriesPerRequest: null });
}

function createBroker(ledgerService: LedgerService) {
  const connection = redisConnection();
  const workerConnection = connection.duplicate();
  const queue = new Queue(QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100
    }
  });
  let worker: Worker | undefined;

  async function publishTransfer(transactionId: string) {
    await queue.add('transfer', { transactionId });
    console.log(`[ledger] publish queue=${QUEUE} job=transfer id=${transactionId}`);
  }

  async function startWorker() {
    worker = new Worker(
      QUEUE,
      (job) => processTransferJob(job, ledgerService),
      { connection: workerConnection, concurrency: prefetchCount() }
    );
    await queue.waitUntilReady();
    await worker.waitUntilReady();
    console.log('[ledger] broker ready');
    console.log(`[ledger] consumer started queue=${QUEUE}`);
  }

  async function closeBroker() {
    if (worker) await worker.close();
    await queue.close();
    await workerConnection.quit();
    await connection.quit();
  }

  return { QUEUE, publishTransfer, startWorker, closeBroker };
}

export { QUEUE, createBroker };
