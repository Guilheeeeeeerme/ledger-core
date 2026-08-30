export class DomainError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TransferInput = {
  transactionId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  description: string;
};

export function validateTransfer(input: Record<string, unknown> | null | undefined): TransferInput {
  const requiredIds = ['transactionId', 'sourceAccountId', 'destinationAccountId'] as const;

  for (const field of requiredIds) {
    if (typeof input?.[field] !== 'string' || !UUID_PATTERN.test(input[field] as string)) {
      throw new DomainError('INVALID_INPUT', `${field} must be a valid UUID`);
    }
  }

  // Money stays in the smallest currency unit, avoiding floating-point rounding.
  if (!Number.isSafeInteger(input!.amount) || (input!.amount as number) <= 0) {
    throw new DomainError('INVALID_AMOUNT', 'amount must be a positive integer in cents');
  }

  if (input!.sourceAccountId === input!.destinationAccountId) {
    throw new DomainError('SAME_ACCOUNT_TRANSFER', 'source and destination must differ');
  }

  if (typeof input!.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input!.currency)) {
    throw new DomainError('INVALID_INPUT', 'currency must be a three-letter code');
  }

  return {
    transactionId: input!.transactionId as string,
    sourceAccountId: input!.sourceAccountId as string,
    destinationAccountId: input!.destinationAccountId as string,
    amount: input!.amount as number,
    currency: (input!.currency as string).toUpperCase(),
    description: typeof input!.description === 'string' ? (input!.description as string).trim() : ''
  };
}
