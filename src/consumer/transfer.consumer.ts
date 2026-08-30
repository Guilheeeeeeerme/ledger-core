import { DomainError } from '../domain/validateTransfer';

export type OffsetCommitter = {
  commit(): Promise<void> | void;
};

export type LedgerConsumerService = {
  processTransfer(transactionId: string): Promise<unknown>;
  markFailed?(transactionId: string, code: string): Promise<unknown>;
};

/**
 * Converts domain and infrastructure outcomes into Kafka offset commit
 * decisions. Commit only after durable processing or permanent failure.
 */
function processDelayMs() {
  const parsed = Number(process.env.PROCESS_DELAY_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function prefetchCount() {
  const parsed = Number(process.env.PREFETCH);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleMessage(
  payload: { transactionId?: string } | null | undefined,
  committer: OffsetCommitter,
  ledgerService: LedgerConsumerService
) {
  if (!payload) return;

  const delayMs = processDelayMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  let transactionId = payload.transactionId;
  console.log(`[ledger] consumer received id=${transactionId || '-'}`);
  try {
    if (!transactionId) throw new Error('missing transactionId');
    await ledgerService.processTransfer(transactionId);
    console.log(`[ledger] kafka offset commit id=${transactionId}`);
    await committer.commit();
  } catch (error) {
    if (error instanceof DomainError) {
      console.error(`[ledger] domain fail code=${error.code} id=${transactionId || '-'} markFailed commit`);
      if (transactionId && ledgerService.markFailed) {
        await ledgerService.markFailed(transactionId, error.code);
      }
      await committer.commit();
      return;
    }
    console.error(`[ledger] transient fail no-commit id=${transactionId || '-'} error=${(error as Error).message}`);
    // Do not commit: KafkaJS will retry the same offset.
  }
}

export async function startConsumer(
  consumer: {
    run(config: {
      autoCommit: boolean;
      eachMessage: (payload: {
        topic: string;
        partition: number;
        message: { offset: string; value: Buffer | null };
      }) => Promise<void>;
    }): Promise<void>;
    commitOffsets(offsets: Array<{ topic: string; partition: number; offset: string }>): Promise<void>;
  },
  ledgerService: LedgerConsumerService
) {
  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: prefetchCount(),
    eachMessage: async ({ topic, partition, message }) => {
      const payload = message.value
        ? JSON.parse(message.value.toString()) as { transactionId?: string }
        : null;
      await handleMessage(
        payload,
        {
          commit: () => consumer.commitOffsets([{
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString()
          }])
        },
        ledgerService
      );
    }
  });
}
