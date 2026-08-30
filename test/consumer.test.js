const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage, startConsumer } = require('../src/consumer');
const { DomainError } = require('../src/domain/validateTransfer');

function message(id = '11111111-1111-4111-8111-111111111111') {
  return { content: Buffer.from(JSON.stringify({ transactionId: id })) };
}

function channel(events) {
  return {
    ack() { events.push('ack'); },
    nack(_message, _allUpTo, requeue) { events.push(`nack:${requeue}`); }
  };
}

describe('handleMessage', () => {
  const savedDelay = process.env.PROCESS_DELAY_MS;
  const savedPrefetch = process.env.PREFETCH;

  afterEach(() => {
    mock.timers.reset();
    if (savedDelay === undefined) delete process.env.PROCESS_DELAY_MS;
    else process.env.PROCESS_DELAY_MS = savedDelay;
    if (savedPrefetch === undefined) delete process.env.PREFETCH;
    else process.env.PREFETCH = savedPrefetch;
  });

  it('acks only after successful processing', async () => {
    const events = [];
    await handleMessage(message(), channel(events), {
      async processTransfer() { events.push('commit'); }
    });
    assert.deepEqual(events, ['commit', 'ack']);
  });

  it('marks permanent domain errors as failed and acknowledges them', async () => {
    const events = [];
    await handleMessage(message(), channel(events), {
      async processTransfer() {
        throw new DomainError('INSUFFICIENT_FUNDS', 'insufficient funds', 409);
      },
      async markFailed(_id, code) { events.push(`failed:${code}`); }
    });
    assert.deepEqual(events, ['failed:INSUFFICIENT_FUNDS', 'ack']);
  });

  it('requeues transient errors', async () => {
    const events = [];
    await handleMessage(message(), channel(events), {
      async processTransfer() { throw new Error('connection lost'); }
    });
    assert.deepEqual(events, ['nack:true']);
  });

  it('waits PROCESS_DELAY_MS before processTransfer when delay is positive', async () => {
    process.env.PROCESS_DELAY_MS = '1000';
    mock.timers.enable({ apis: ['setTimeout'] });

    const events = [];
    const done = handleMessage(message(), channel(events), {
      async processTransfer() { events.push('commit'); }
    });

    assert.deepEqual(events, []);
    mock.timers.tick(999);
    assert.deepEqual(events, []);
    mock.timers.tick(1);
    await done;
    assert.deepEqual(events, ['commit', 'ack']);
  });

  it('does not wait when PROCESS_DELAY_MS is 0 or unset', async () => {
    process.env.PROCESS_DELAY_MS = '0';
    const events = [];
    const start = Date.now();
    await handleMessage(message(), channel(events), {
      async processTransfer() { events.push('commit'); }
    });
    assert.ok(Date.now() - start < 50, 'expected no meaningful wait');
    assert.deepEqual(events, ['commit', 'ack']);
  });

  it('applies delay before domain and transient failure paths', async () => {
    process.env.PROCESS_DELAY_MS = '500';
    mock.timers.enable({ apis: ['setTimeout'] });

    let domainReached = false;
    const domainEvents = [];
    const domainDone = handleMessage(message(), channel(domainEvents), {
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
    assert.deepEqual(domainEvents, ['failed:INSUFFICIENT_FUNDS', 'ack']);

    let transientReached = false;
    const transientEvents = [];
    const transientDone = handleMessage(message(), channel(transientEvents), {
      async processTransfer() {
        transientReached = true;
        throw new Error('connection lost');
      }
    });
    assert.equal(transientReached, false);
    mock.timers.tick(500);
    await transientDone;
    assert.equal(transientReached, true);
    assert.deepEqual(transientEvents, ['nack:true']);
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
      async prefetch(count) { calls.push(['prefetch', count]); },
      async consume() { calls.push(['consume']); }
    }, {});
    assert.deepEqual(calls[0], ['prefetch', 10]);
  });

  it('defaults PREFETCH to 5', async () => {
    delete process.env.PREFETCH;
    const calls = [];
    await startConsumer({
      async prefetch(count) { calls.push(['prefetch', count]); },
      async consume() { calls.push(['consume']); }
    }, {});
    assert.deepEqual(calls[0], ['prefetch', 5]);
  });
});
