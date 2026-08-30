export class DomainError extends Error {
  name: 'DomainError';
  code: string;
  status: number;
  constructor(code: string, message: string, status?: number);
}

export function validateTransfer(input: {
  transactionId?: unknown;
  sourceAccountId?: unknown;
  destinationAccountId?: unknown;
  amount?: unknown;
  currency?: unknown;
  description?: unknown;
}): {
  transactionId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  description: string;
};
