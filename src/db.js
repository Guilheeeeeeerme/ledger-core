const { Sequelize } = require('sequelize');
const { initModels, seedAccounts } = require('./models');

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgres://ledger:ledger@localhost:5432/ledger',
  {
    logging: false,
    dialect: 'postgres'
  }
);

const { Account, Transaction, LedgerEntry } = initModels(sequelize);

async function withTransaction(callback) {
  return sequelize.transaction(callback);
}

async function healthCheck() {
  await sequelize.authenticate();
}

/**
 * Creates tables from model definitions (mirrors schema.sql constraints where
 * Sequelize can express them) and seeds the fixed demo accounts idempotently.
 */
async function prepareDatabase() {
  await sequelize.sync();
  await seedAccounts(Account);
}

async function close() {
  await sequelize.close();
}

module.exports = {
  sequelize,
  Account,
  Transaction,
  LedgerEntry,
  withTransaction,
  healthCheck,
  prepareDatabase,
  close
};
