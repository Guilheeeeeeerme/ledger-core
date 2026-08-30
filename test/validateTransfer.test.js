const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validateTransfer, DomainError } = require('../src/domain/validateTransfer');

const validTransfer = {
  transactionId: '11111111-1111-4111-8111-111111111111',
  sourceAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  destinationAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  amount: 2500,
  currency: 'brl',
  description: '  Payment  '
};

describe('validateTransfer', () => {
  it('normalizes a valid transfer', () => {
    assert.deepEqual(validateTransfer(validTransfer), {
      ...validTransfer,
      currency: 'BRL',
      description: 'Payment'
    });
  });

  for (const amount of [0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid amount ${amount}`, () => {
      assert.throws(
        () => validateTransfer({ ...validTransfer, amount }),
        (error) => error instanceof DomainError && error.code === 'INVALID_AMOUNT'
      );
    });
  }

  it('rejects transfers to the same account', () => {
    assert.throws(
      () => validateTransfer({
        ...validTransfer,
        destinationAccountId: validTransfer.sourceAccountId
      }),
      (error) => error.code === 'SAME_ACCOUNT_TRANSFER'
    );
  });

  it('rejects missing required fields', () => {
    const { sourceAccountId, ...input } = validTransfer;
    assert.throws(
      () => validateTransfer(input),
      (error) => error.code === 'INVALID_INPUT'
    );
  });

  it('rejects malformed UUIDs', () => {
    assert.throws(
      () => validateTransfer({ ...validTransfer, transactionId: 'not-a-uuid' }),
      (error) => error.code === 'INVALID_INPUT'
    );
  });
});
