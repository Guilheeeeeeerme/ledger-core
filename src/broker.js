const amqp = require('amqplib');

const QUEUE = process.env.QUEUE_NAME || 'ledger.transfers.raw';
let connection;
let channel;

// One process-level channel is sufficient for this MVP and avoids reconnecting per request.
async function connectBroker() {
  if (channel) return channel;
  const url = process.env.RABBITMQ_URL || 'amqp://ledger:ledger@localhost:5672';
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  connection.on('close', () => { channel = undefined; connection = undefined; });
  return channel;
}

async function publishTransfer(transactionId) {
  const brokerChannel = await connectBroker();
  brokerChannel.sendToQueue(
    QUEUE,
    Buffer.from(JSON.stringify({ transactionId })),
    { persistent: true, contentType: 'application/json' }
  );
  console.log(`[ledger] publish queue=${QUEUE} id=${transactionId}`);
}

async function closeBroker() {
  if (connection) await connection.close();
}

module.exports = { QUEUE, connectBroker, publishTransfer, closeBroker };
