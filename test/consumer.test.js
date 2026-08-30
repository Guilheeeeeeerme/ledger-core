const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { handleMessage } = require('../dist/consumer/transfer.consumer');
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
