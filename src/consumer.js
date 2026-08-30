const QUEUE = process.env.QUEUE_NAME || 'ledger.transfers.typeorm';

function isDomainError(error) {
  return Boolean(error && error.name === 'DomainError' && error.code);
}

function processDelayMs() {
  const parsed = Number(process.env.PROCESS_DELAY_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function prefetchCount() {
  const parsed = Number(process.env.PREFETCH);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converts domain and infrastructure outcomes into explicit AMQP delivery
 * decisions. This boundary is where at-least-once delivery becomes safe.
 */
async function handleMessage(message, channel, ledgerService) {
  if (!message) return;

  const delayMs = processDelayMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  let transactionId;
  try {
    ({ transactionId } = JSON.parse(message.content.toString()));
    console.log(`[ledger] consumer received id=${transactionId}`);
    await ledgerService.processTransfer(transactionId);
    // Ack happens after processTransfer resolves, therefore after its DB commit.
    console.log(`[ledger] ack id=${transactionId}`);
    channel.ack(message);
  } catch (error) {
    if (isDomainError(error)) {
      console.error(`[ledger] domain fail code=${error.code} id=${transactionId || '-'} markFailed ack`);
      if (transactionId) await ledgerService.markFailed(transactionId, error.code);
      channel.ack(message);
      return;
    }
    console.error(`[ledger] transient fail nack requeue id=${transactionId || '-'} error=${error.message}`);
    channel.nack(message, false, true);
  }
}

async function startConsumer(channel, ledgerService) {
  await channel.prefetch(prefetchCount());
  await channel.consume(
    QUEUE,
    (message) => handleMessage(message, channel, ledgerService),
    { noAck: false }
  );
  console.log(`[ledger] consumer started queue=${QUEUE}`);
}

module.exports = { handleMessage, startConsumer };
