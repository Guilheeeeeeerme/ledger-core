export function handleMessage(
  message: { content: Buffer } | null,
  channel: { ack(message: unknown): void; nack(message: unknown, allUpTo: boolean, requeue: boolean): void },
  ledgerService: { processTransfer(id: string): Promise<unknown>; markFailed(id: string, code: string): Promise<unknown> }
): Promise<void>;

export function startConsumer(
  channel: { prefetch(count: number): Promise<unknown>; consume(queue: string, handler: Function, options: object): Promise<unknown> },
  ledgerService: unknown
): Promise<void>;
