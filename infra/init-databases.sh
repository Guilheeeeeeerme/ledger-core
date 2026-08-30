#!/bin/bash
set -e
for db in ledger_raw ledger_sequelize ledger_typeorm ledger_bullmq ledger_express_prisma ledger_kafka; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE $db"
done
