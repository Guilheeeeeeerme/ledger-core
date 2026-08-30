const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage, startConsumer } = require('../dist/consumer/transfer.consumer');
const { DomainError } = require('../dist/domain/validateTransfer');

function payload(id = '11111111-1111-4111-8111-111111111111') {
  return { transactionId: id };
}

function committer(events) {
  return {
    async commit() { events.push('commit'); }
  };
}

describe('handleMessage', () => {
  it('commits only after successful processing', async () => {
    const events = [];
    await handleMessage(payload(), committer(events), {
      async processTransfer() { events.push('process'); }
    });
    assert.deepEqual(events, ['process', 'commit']);
  });

  it('marks permanent domain errors as failed and commits them', async () => {
    const events = [];
    await handleMessage(payload(), committer(events), {
      async processTransfer() {
        throw new DomainError('INSUFFICIENT_FUNDS', 'insufficient funds', 409);
      },
      async markFailed(_id, code) { events.push(`failed:${code}`); }
    });
    assert.deepEqual(events, ['failed:INSUFFICIENT_FUNDS', 'commit']);
  });

  it('does not commit transient errors', async () => {
    const events = [];
    await handleMessage(payload(), committer(events), {
      async processTransfer() { throw new Error('connection lost'); }
    });
    assert.deepEqual(events, []);
  });
});

describe('handleMessage delay', () => {
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
    const done = handleMessage(payload(), committer(events), {
      async processTransfer() { events.push('process'); }
    });

    assert.deepEqual(events, []);
    mock.timers.tick(999);
    assert.deepEqual(events, []);
    mock.timers.tick(1);
    await done;
    assert.deepEqual(events, ['process', 'commit']);
  });

  it('does not wait when PROCESS_DELAY_MS is 0 or unset', async () => {
    process.env.PROCESS_DELAY_MS = '0';
    const events = [];
    const start = Date.now();
    await handleMessage(payload(), committer(events), {
      async processTransfer() { events.push('process'); }
    });
    assert.ok(Date.now() - start < 50, 'expected no meaningful wait');
    assert.deepEqual(events, ['process', 'commit']);
  });

  it('applies delay before domain and transient failure paths', async () => {
    process.env.PROCESS_DELAY_MS = '500';
    mock.timers.enable({ apis: ['setTimeout'] });

    let domainReached = false;
    const domainEvents = [];
    const domainDone = handleMessage(payload(), committer(domainEvents), {
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
    assert.deepEqual(domainEvents, ['failed:INSUFFICIENT_FUNDS', 'commit']);

    let transientReached = false;
    const transientEvents = [];
    const transientDone = handleMessage(payload(), committer(transientEvents), {
      async processTransfer() {
        transientReached = true;
        throw new Error('connection lost');
      }
    });
    assert.equal(transientReached, false);
    mock.timers.tick(500);
    await transientDone;
    assert.equal(transientReached, true);
    assert.deepEqual(transientEvents, []);
  });
});

describe('startConsumer', () => {
  const savedPrefetch = process.env.PREFETCH;

  afterEach(() => {
    if (savedPrefetch === undefined) delete process.env.PREFETCH;
    else process.env.PREFETCH = savedPrefetch;
  });

  it('uses PREFETCH from env when set', async () => {
    process.env.PREFETCH = '10';
    const calls = [];
    await startConsumer({
      async run(config) { calls.push(config.partitionsConsumedConcurrently); }
    }, {});
    assert.equal(calls[0], 10);
  });

  it('defaults PREFETCH to 5', async () => {
    delete process.env.PREFETCH;
    const calls = [];
    await startConsumer({
      async run(config) { calls.push(config.partitionsConsumedConcurrently); }
    }, {});
    assert.equal(calls[0], 5);
  });
});
