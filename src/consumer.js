const { DomainError } = require('./domain/validateTransfer');
const { QUEUE } = require('./broker');

/**
 * Converts domain and infrastructure outcomes into explicit AMQP delivery
 * decisions. This boundary is where at-least-once delivery becomes safe.
 */
async function handleMessage(message, channel, ledgerService) {
  if (!message) return;

  let transactionId;
  try {
    ({ transactionId } = JSON.parse(message.content.toString()));
    console.log(`[ledger] consumer received id=${transactionId}`);
    await ledgerService.processTransfer(transactionId);
    // Ack happens after processTransfer resolves, therefore after its DB commit.
    console.log(`[ledger] ack id=${transactionId}`);
    channel.ack(message);
  } catch (error) {
    if (error instanceof DomainError) {
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
  await channel.prefetch(5);
  await channel.consume(
    QUEUE,
    (message) => handleMessage(message, channel, ledgerService),
    { noAck: false }
  );
  console.log(`[ledger] consumer started queue=${QUEUE}`);
}

module.exports = { handleMessage, startConsumer };
