const { describe, it, afterEach, mock } = require('node:test');
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

describe('processTransferJob delay', () => {
  const savedDelay = process.env.PROCESS_DELAY_MS;

  afterEach(() => {
    mock.timers.reset();
    if (savedDelay === undefined) delete process.env.PROCESS_DELAY_MS;
    else process.env.PROCESS_DELAY_MS = savedDelay;
  });

  it('waits PROCESS_DELAY_MS before processTransfer when delay is positive', async () => {
    process.env.PROCESS_DELAY_MS = '1000';
    mock.timers.enable({ apis: ['setTimeout'] });

    const events = [];
    const done = processTransferJob(job, {
      async processTransfer() { events.push('commit'); }
    });

    assert.deepEqual(events, []);
    mock.timers.tick(999);
    assert.deepEqual(events, []);
    mock.timers.tick(1);
    await done;
    assert.deepEqual(events, ['commit']);
  });

  it('does not wait when PROCESS_DELAY_MS is 0 or unset', async () => {
    process.env.PROCESS_DELAY_MS = '0';
    const events = [];
    const start = Date.now();
    await processTransferJob(job, {
      async processTransfer() { events.push('commit'); }
    });
    assert.ok(Date.now() - start < 50, 'expected no meaningful wait');
    assert.deepEqual(events, ['commit']);
  });

  it('applies delay before domain and transient failure paths', async () => {
    process.env.PROCESS_DELAY_MS = '500';
    mock.timers.enable({ apis: ['setTimeout'] });

    let domainReached = false;
    const domainEvents = [];
    const domainDone = processTransferJob(job, {
      async processTransfer() {
        domainReached = true;
        throw new DomainError('INSUFFICIENT_FUNDS', 'insufficient funds', 409);
      },
      async markFailed(_id, code) { domainEvents.push(`failed:${code}`); }
    });
    assert.equal(domainReached, false);
    mock.timers.tick(499);
    assert.equal(domainReached, false);
    mock.timers.tick(1);
    await domainDone;
    assert.equal(domainReached, true);
    assert.deepEqual(domainEvents, ['failed:INSUFFICIENT_FUNDS']);

    let transientReached = false;
    const transientDone = processTransferJob(job, {
      async processTransfer() {
        transientReached = true;
        throw new Error('connection lost');
      }
    });
    assert.equal(transientReached, false);
    mock.timers.tick(500);
    await assert.rejects(transientDone, { message: 'connection lost' });
    assert.equal(transientReached, true);
  });
});
