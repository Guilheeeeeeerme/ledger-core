const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { processTransferJob } = require('../src/consumer');
const { DomainError } = require('../src/domain/validateTransfer');

const job = { data: { transactionId: '11111111-1111-4111-8111-111111111111' } };

describe('processTransferJob', () => {
  it('completes the job after successful processing', async () => {
    const events = [];
    await processTransferJob(job, {
      async processTransfer() { events.push('commit'); }
    });
    assert.deepEqual(events, ['commit']);
  });

  it('marks permanent domain errors as failed and completes the job', async () => {
    const events = [];
    await processTransferJob(job, {
      async processTransfer() {
        throw new DomainError('INSUFFICIENT_FUNDS', 'insufficient funds', 409);
      },
      async markFailed(_id, code) { events.push(`failed:${code}`); }
    });
    assert.deepEqual(events, ['failed:INSUFFICIENT_FUNDS']);
  });

  it('rethrows transient errors so BullMQ retries', async () => {
    await assert.rejects(
      () => processTransferJob(job, {
        async processTransfer() { throw new Error('connection lost'); }
      }),
      { message: 'connection lost' }
    );
  });
});
