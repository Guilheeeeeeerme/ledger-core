import { DomainError } from './domain/validateTransfer';
import type { LedgerService } from './ledgerService';

type TransferJob = { data: { transactionId?: string } };

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

async function processTransferJob(job: TransferJob, ledgerService: Pick<LedgerService, 'processTransfer'> & Partial<Pick<LedgerService, 'markFailed'>>) {
  const delayMs = processDelayMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  const transactionId = job.data.transactionId;
  console.log(`[ledger] worker received job transaction=${transactionId}`);
  try {
    await ledgerService.processTransfer(transactionId as string);
    console.log(`[ledger] job complete id=${transactionId}`);
  } catch (error) {
    if (error instanceof DomainError) {
      console.error(`[ledger] domain fail code=${error.code} id=${transactionId || '-'} markFailed complete`);
      if (transactionId) await ledgerService.markFailed?.(transactionId, error.code);
      return;
    }
    console.error(`[ledger] transient fail retry id=${transactionId || '-'} error=${(error as Error).message}`);
    throw error;
  }
}

export { processTransferJob };
