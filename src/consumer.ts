import { DomainError } from './domain/validateTransfer';
import type { LedgerService } from './ledgerService';

type TransferJob = { data: { transactionId?: string } };

async function processTransferJob(job: TransferJob, ledgerService: Pick<LedgerService, 'processTransfer'> & Partial<Pick<LedgerService, 'markFailed'>>) {
  const transactionId = job.data.transactionId;
  try {
    await ledgerService.processTransfer(transactionId as string);
  } catch (error) {
    if (error instanceof DomainError) {
      if (transactionId) await ledgerService.markFailed?.(transactionId, error.code);
      return;
    }
    throw error;
  }
}

export { processTransferJob };
