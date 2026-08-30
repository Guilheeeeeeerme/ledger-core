# Ledger Core

Ledger Core is a runnable double-entry ledger MVP that demonstrates the complete path of a financial transfer through a NestJS HTTP API, Apache Kafka, a transactional consumer, Prisma, and PostgreSQL.

It focuses on the failure modes that matter in financial systems: atomic balance changes, balanced entries, concurrent spending, duplicate message delivery, permanent domain failures, and transient infrastructure failures.

## Architecture

```text
React tester (same origin)
              │
              ▼
      NestJS HTTP API
              │ persist transaction as pending
              ▼
         PostgreSQL ◄──────────────────────┐
              │                            │ atomic commit
              │ produce transaction ID     │
              ▼                            │
          Kafka ──► Consumer ──► Ledger service
```

The API and consumer do not implement accounting rules themselves. Both delegate to `LedgerService`, which owns account locking, currency and balance validation, double-entry persistence, balance updates, and transaction status changes.

Stack variants and the checkout-then-Compose operator flow are documented in [docs/STACKS.md](docs/STACKS.md).

### Components

- **NestJS API:** accepts transfers and exposes accounts, transaction status, history, and health.
- **Kafka:** provides durable asynchronous delivery through topic `ledger.transfers.kafka` (consumer group `ledger-kafka`).
- **Consumer:** maps successful commits to an offset commit, permanent domain failures to `failed` plus offset commit, and transient failures to no offset commit (retry).
- **Prisma / PostgreSQL:** stores accounts, transactions, and immutable ledger entries. Row locks use `SELECT ... FOR UPDATE` via `$queryRaw` inside `$transaction`.
- **React tester:** Vite app served as static files from the API. Same-origin `/api/...` calls.

For product requirements and acceptance criteria, see [docs/PRD.md](docs/PRD.md).

## Quick start

### Requirements

- Docker Engine with Docker Compose v2
- Ports `3000` and `9092` available

Start the full stack (API, React tester, Postgres, broker):

```bash
git checkout stack/nestjs-prisma-kafka
docker compose up --build --force-recreate
```

Wait until `app`, `postgres`, and `kafka` report healthy, then open:

- React tester: http://localhost:3000
- Kafka broker: localhost:9092

The application applies its Prisma schema and seed during startup. No manual database setup is required.

The seed contains:

- Alice Account: BRL 1,000.00 (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)
- Bob Account: BRL 500.00 (`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`)

Stop the stack while preserving PostgreSQL data:

```bash
docker compose down
```

Remove the stack and reset all seed balances:

```bash
docker compose down -v
```

## Demo flow

1. Open the React tester at http://localhost:3000.
2. Confirm health shows `status: ok` and the current `stack` name.
3. Select source and destination accounts.
4. Enter an amount and submit the transfer.
5. Observe the transaction move from `pending` to `completed` or `failed`.
6. Confirm both balances and the selected account history update.
7. Inspect Kafka topic `ledger.transfers.kafka` on broker `localhost:9092`.

The tester polls transaction status every 500 ms for up to 10 seconds. This keeps the MVP small; a production UI could use server-sent events or WebSockets.

## API reference

All monetary values are integer minor units. For BRL, `2500` means BRL 25.00.

### Health

```http
GET /api/health
```

Success response:

```json
{ "status": "ok", "stack": "nestjs-prisma-kafka" }
```

### List accounts

```http
GET /api/accounts
```

Returns account IDs, names, currencies, balances, and creation timestamps.

### Create a transfer

```http
POST /api/transactions
Content-Type: application/json
```

```json
{
  "transactionId": "11111111-1111-4111-8111-111111111111",
  "sourceAccountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "destinationAccountId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "amount": 2500,
  "currency": "BRL",
  "description": "Example payment"
}
```

`transactionId` is optional. The API generates a UUID when it is omitted. A valid request returns `202 Accepted` with a `pending` transaction. If the same ID and payload already exist, the existing transaction is returned without another balance mutation. Reusing an ID with different financial fields returns `409 Conflict`.

Example:

```bash
curl -X POST http://localhost:3000/api/transactions \
  -H 'content-type: application/json' \
  -d '{
    "transactionId":"11111111-1111-4111-8111-111111111111",
    "sourceAccountId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "destinationAccountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "amount":2500,
    "currency":"BRL",
    "description":"Example payment"
  }'
```

### Get transaction status

```http
GET /api/transactions/:transactionId
```

Possible statuses:

- `pending`: persisted and awaiting successful consumer processing.
- `completed`: both ledger entries and both balances committed atomically.
- `failed`: a permanent domain rule rejected processing; `errorCode` explains why.

### Get account history

```http
GET /api/accounts/:accountId/transactions
```

Entries are returned newest first. A negative amount is an outgoing movement; a positive amount is incoming.

### Error format

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "source account has insufficient funds"
  }
}
```

Relevant codes include `INVALID_INPUT`, `INVALID_AMOUNT`, `SAME_ACCOUNT_TRANSFER`, `ACCOUNT_NOT_FOUND`, `CURRENCY_MISMATCH`, `INSUFFICIENT_FUNDS`, `TRANSACTION_CONFLICT`, and `TRANSACTION_NOT_FOUND`.

## Data model

### Accounts

`accounts.balance` is a read-optimized projection stored in minor units. The service changes it only in the same database transaction that inserts ledger entries.

### Transactions

`transactions.id` is both the public transaction identifier and idempotency key. Status captures asynchronous processing state.

### Ledger entries

Every completed transfer creates exactly two rows:

```text
source account       -amount
destination account  +amount
                      -------
net                         0
```

The unique `(transaction_id, account_id)` constraint prevents a transaction from inserting duplicate entries for either account.

## Reliability model

### Atomicity

The consumer performs these operations in one PostgreSQL transaction:

1. Lock the transaction row.
2. Return immediately if it is no longer `pending`.
3. Lock both accounts in sorted UUID order.
4. Validate account existence, currency, and available funds.
5. Insert equal and opposite ledger entries.
6. Apply equal and opposite balance deltas.
7. Mark the transaction `completed`.
8. Commit.

Any error rolls back every step.

### Concurrency

`SELECT ... FOR UPDATE` via Prisma `$queryRaw` prevents two concurrent transfers from spending the same source balance. Sorting account IDs before locking reduces deadlock risk for transfers moving in opposite directions.

### Idempotency

Kafka provides at-least-once delivery, so duplicate messages are expected. A completed or failed transaction is a no-op when redelivered. The consumer commits the offset only after `processTransfer` returns, which means the database commit has completed.

### Failure classification

- Domain errors are permanent for the submitted transaction. The consumer marks it `failed` and commits the offset.
- Unexpected infrastructure errors are considered transient. The consumer does not commit the offset, so Kafka redelivers the message.
- If the process exits after commit but before the offset commit, Kafka redelivers the message and transaction status makes processing idempotent.

## Testing

Local requirements: Node.js 22 or newer.

```bash
npm install
npm test
```

The suite covers:

- transfer input normalization and validation;
- deterministic account lock order;
- balanced entry construction;
- insufficient funds and rollback behavior;
- database parameter types for balance deltas;
- idempotent transaction processing;
- API status codes and response contracts;
- consumer offset commit semantics;
- React tester static delivery;
- Compose and documentation contracts;
- English-only repository content.

For an integrated check, start Compose and submit the same `transactionId` twice. Account balances must change once, and the transaction must retain exactly two entries whose sum is zero.

## Project structure

```text
src/domain/validateTransfer.ts  Input normalization and domain errors
src/ledger/ledger.service.ts     Accounting invariants and Prisma operations
src/broker/kafka.service.ts      Kafka producer connection and topic setup
src/consumer/transfer.consumer.ts Offset commit policy for Kafka delivery
src/ledger/ledger.controller.ts  NestJS routes
src/app.ts                       HTTP app factory for tests and production
src/main.ts                      Dependency composition and startup retries
prisma/schema.prisma             Accounts, transactions, ledger entries, seed IDs
web/                             React + Vite tester (source)
public/                          Production build of the tester (Docker/`npm run build:web`)
test/                            Unit and HTTP contract tests
test/helpers/httpApp.js          Nest getHttpServer factory used by API tests
stack.manifest.json              Current stack identity
docker-compose.yml               App, PostgreSQL, and Kafka
docs/PRD.md                      Product requirements and acceptance criteria
docs/STACKS.md                   Checkout a stack branch and run Compose
```

## Configuration

The container uses these environment variables:

- `PORT`, default `3000`
- `DATABASE_URL`, default `postgres://ledger:ledger@localhost:5432/ledger`
- `KAFKA_BROKERS`, default `localhost:9092`
- `KAFKA_TOPIC`, default `ledger.transfers.kafka`
- `KAFKA_GROUP_ID`, default `ledger-kafka`
- `STACK_NAME`, default `nestjs-prisma-kafka`

- `PROCESS_DELAY_MS`, default `0` in code; Compose and `.env.parallel.example` set `5000` (5s) so the queue can accumulate Ready messages
- `PREFETCH`, default `5` (max unacked messages per consumer)

Compose supplies service-network URLs automatically. Credentials are intentionally simple because this configuration is for local demonstration only.

## Limitations

This is an evaluation-focused MVP, not a production banking system. It intentionally omits:

- authentication, authorization, and tenant isolation;
- TLS and secret management;
- multiple currencies within one transfer or foreign-exchange conversion;
- reversals, refunds, holds, and available-versus-posted balance distinctions;
- outbox-based atomicity between PostgreSQL and Kafka publication;
- dead-letter topics, bounded retry policy, and operational alerting;
- cursor pagination and archival for large histories;
- reconciliation jobs and stored-balance drift detection;
- production-grade observability and audit access controls.

The API persists `pending` before producing. A broker failure can therefore leave a pending row until the client retries with the same `transactionId`; a production design would use a transactional outbox.

## License

Released under the [MIT License](LICENSE).
