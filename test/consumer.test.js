const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage } = require('../src/consumer');
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
});
