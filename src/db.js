if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://ledger:ledger@localhost:5432/ledger';
}

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Applies idempotent DDL and seed from schema.sql. Prisma Client has no
 * FOR UPDATE helper, so runtime locking stays on raw SQL; bootstrap stays SQL too.
 */
async function applySchema(sqlText) {
  const statements = sqlText.split(';').map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

module.exports = { prisma, applySchema };
