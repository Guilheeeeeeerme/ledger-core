class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateTransfer(input) {
  const requiredIds = ['transactionId', 'sourceAccountId', 'destinationAccountId'];

  for (const field of requiredIds) {
    if (typeof input?.[field] !== 'string' || !UUID_PATTERN.test(input[field])) {
      throw new DomainError('INVALID_INPUT', `${field} must be a valid UUID`);
    }
  }

  // Money stays in the smallest currency unit, avoiding floating-point rounding.
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new DomainError('INVALID_AMOUNT', 'amount must be a positive integer in cents');
  }

  if (input.sourceAccountId === input.destinationAccountId) {
    throw new DomainError('SAME_ACCOUNT_TRANSFER', 'source and destination must differ');
  }

  if (typeof input.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input.currency)) {
    throw new DomainError('INVALID_INPUT', 'currency must be a three-letter code');
  }

  return {
    ...input,
    currency: input.currency.toUpperCase(),
    description: typeof input.description === 'string' ? input.description.trim() : ''
  };
}

module.exports = { DomainError, validateTransfer };
