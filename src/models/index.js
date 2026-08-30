const { DataTypes } = require('sequelize');

const SEED_ACCOUNTS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Alice Account',
    currency: 'BRL',
    balance: 100000
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Bob Account',
    currency: 'BRL',
    balance: 50000
  }
];

function initModels(sequelize) {
  const Account = sequelize.define('Account', {
    id: { type: DataTypes.UUID, primaryKey: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    balance: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: { min: 0 }
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'accounts',
    timestamps: false,
    underscored: false
  });

  const Transaction = sequelize.define('Transaction', {
    id: { type: DataTypes.UUID, primaryKey: true },
    sourceAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'source_account_id'
    },
    destinationAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'destination_account_id'
    },
    amount: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: { min: 1 }
    },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: ''
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { isIn: [['pending', 'completed', 'failed']] }
    },
    errorCode: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'error_code'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'processed_at'
    }
  }, {
    tableName: 'transactions',
    timestamps: false,
    underscored: false,
    validate: {
      sourceDiffersFromDestination() {
        if (this.sourceAccountId === this.destinationAccountId) {
          throw new Error('source_account_id must differ from destination_account_id');
        }
      }
    }
  });

  const LedgerEntry = sequelize.define('LedgerEntry', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4
    },
    transactionId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'transaction_id'
    },
    accountId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'account_id'
    },
    amount: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        notZero(value) {
          if (Number(value) === 0) throw new Error('amount must not be zero');
        }
      }
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'ledger_entries',
    timestamps: false,
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ['transaction_id', 'account_id']
      },
      {
        name: 'idx_entries_account_created',
        fields: ['account_id', { name: 'created_at', order: 'DESC' }]
      }
    ]
  });

  Account.hasMany(LedgerEntry, { foreignKey: 'accountId', sourceKey: 'id' });
  LedgerEntry.belongsTo(Account, { foreignKey: 'accountId', targetKey: 'id' });
  Transaction.hasMany(LedgerEntry, { foreignKey: 'transactionId', sourceKey: 'id' });
  LedgerEntry.belongsTo(Transaction, { foreignKey: 'transactionId', targetKey: 'id' });
  Transaction.belongsTo(Account, { as: 'sourceAccount', foreignKey: 'sourceAccountId' });
  Transaction.belongsTo(Account, { as: 'destinationAccount', foreignKey: 'destinationAccountId' });

  return { Account, Transaction, LedgerEntry };
}

async function seedAccounts(Account) {
  for (const account of SEED_ACCOUNTS) {
    await Account.findOrCreate({
      where: { id: account.id },
      defaults: account
    });
  }
}

module.exports = { initModels, seedAccounts, SEED_ACCOUNTS };
