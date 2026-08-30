# Product Requirements Document — Ledger Core MVP

## 1. Purpose

Build a self-contained ledger MVP that demonstrates a financial transfer from submission through asynchronous processing and durable accounting. The product must validate transfers, maintain account balances, persist a double-entry audit trail, expose related history, and remain consistent during duplicate delivery or failure.

The complete system must start with:

```bash
docker compose up --build
```

## 2. Target audience

- Engineering evaluators reviewing financial-system fundamentals.
- Developers learning transaction boundaries, idempotency, and broker acknowledgement semantics.
- Operators demonstrating the complete flow locally without external services.

## 3. Scope

### Included

- JavaScript backend on Node.js 22.
- Express HTTP API.
- PostgreSQL persistence.
- RabbitMQ asynchronous delivery and Management UI.
- React tester (Vite) served as static files by the API.
- BRL seed accounts and integer minor-unit amounts.
- Double-entry transfer processing.
- Database locks and atomic balance updates.
- Idempotent broker redelivery.
- Account balance, transaction status, and account-history queries.
- Automated unit, HTTP, deployment-contract, and documentation tests.

### Excluded

- Authentication and authorization.
- Tenant isolation.
- Foreign exchange or cross-currency transfers.
- Holds, reversals, refunds, and chargebacks.
- Transactional outbox or exactly-once delivery claims.
- Dead-letter queue management and bounded retry policy.
- Cursor pagination, archival, and reconciliation jobs.
- Production secret management, TLS, monitoring, and audit controls.

## 4. Primary user flow

1. The user opens `http://localhost:3000`.
2. The React tester retrieves seeded accounts and current balances.
3. The user selects source and destination accounts, enters a BRL amount, and submits.
4. The API validates the request, persists a `pending` transaction, and publishes its ID to RabbitMQ.
5. The consumer receives the transaction ID and starts a PostgreSQL transaction.
6. The ledger service locks the transaction and both accounts.
7. The ledger service validates account existence, matching currency, and available funds.
8. It inserts equal and opposite entries, updates both balances, and marks the transaction `completed` in one commit.
9. The consumer acknowledges the message only after that commit.
10. The tester polls transaction status and refreshes balances and history.

## 5. Functional requirements

### FR-1 — Submit a transfer

`POST /api/transactions` accepts:

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

`transactionId` is optional and generated when absent. The endpoint returns `202 Accepted` after durable `pending` persistence and broker publication.

### FR-2 — Process a transfer asynchronously

The RabbitMQ consumer receives only the transaction ID. PostgreSQL remains the authoritative source for all financial fields.

### FR-3 — Query accounts

`GET /api/accounts` returns account identifier, display name, currency, stored balance, and creation timestamp.

### FR-4 — Query transaction status

`GET /api/transactions/:id` returns `pending`, `completed`, or `failed`, plus the permanent error code when applicable.

### FR-5 — Query account history

`GET /api/accounts/:id/transactions` returns the account's ledger entries newest first, including signed amount, currency, description, counterparty account, and creation timestamp.

### FR-6 — Observe system health

`GET /api/health` verifies that the application can query PostgreSQL and returns `{ "status": "ok" }` on success.

## 6. Domain rules

- IDs supplied by clients must be valid UUIDs.
- `amount` must be a positive JavaScript safe integer.
- Amounts represent minor currency units; floating-point domain amounts are prohibited.
- Source and destination must differ.
- Both accounts must exist.
- Transaction currency must match both account currencies.
- Source balance may not become negative.
- A completed transfer creates exactly two non-zero entries.
- Source entry equals `-amount`.
- Destination entry equals `+amount`.
- The two entries sum to zero.
- Ledger entries and stored balances change in the same database transaction.
- A transaction ID may identify only one financial payload.

## 7. Data model

### `accounts`

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `currency CHAR(3) NOT NULL`
- `balance BIGINT NOT NULL CHECK (balance >= 0)`
- `created_at TIMESTAMPTZ NOT NULL`

### `transactions`

- `id UUID PRIMARY KEY`
- `source_account_id UUID NOT NULL`
- `destination_account_id UUID NOT NULL`
- `amount BIGINT NOT NULL CHECK (amount > 0)`
- `currency CHAR(3) NOT NULL`
- `description TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed'))`
- `error_code TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `processed_at TIMESTAMPTZ NULL`

### `ledger_entries`

- `id UUID PRIMARY KEY`
- `transaction_id UUID NOT NULL`
- `account_id UUID NOT NULL`
- `amount BIGINT NOT NULL CHECK (amount <> 0)`
- `created_at TIMESTAMPTZ NOT NULL`
- `UNIQUE(transaction_id, account_id)`

## 8. Consistency and concurrency

Transfer processing must occur inside one PostgreSQL transaction:

1. Lock the transaction row with `FOR UPDATE`.
2. Return the stored result when status is not `pending`.
3. Sort both account IDs and lock those rows with `FOR UPDATE`.
4. Validate the financial rules.
5. Insert both ledger entries.
6. Update both stored balances.
7. Mark the transaction `completed`.
8. Commit.

Sorted account locks reduce deadlock risk. Row locks prevent concurrent requests from spending the same available balance.

## 9. Idempotency and broker behavior

RabbitMQ delivery is treated as at least once.

- `transactions.id` is the idempotency key.
- A redelivered completed or failed transaction is a no-op.
- A repeated HTTP request with the same ID and same financial payload returns the existing transaction.
- The same ID with a different source, destination, amount, or currency returns `TRANSACTION_CONFLICT`.
- Consumer `ack` occurs only after a successful commit or after a permanent domain failure is durably marked `failed`.
- Unexpected errors use `nack(message, false, true)` so RabbitMQ can redeliver.

The MVP does not claim atomicity between initial PostgreSQL persistence and RabbitMQ publication. Retrying the same HTTP request republishes an existing `pending` transaction. A production system should use a transactional outbox.

## 10. Error contract

Errors use:

```json
{
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "amount must be a positive integer in cents"
  }
}
```

Expected domain codes:

- `INVALID_INPUT`
- `INVALID_AMOUNT`
- `SAME_ACCOUNT_TRANSFER`
- `ACCOUNT_NOT_FOUND`
- `CURRENCY_MISMATCH`
- `INSUFFICIENT_FUNDS`
- `TRANSACTION_CONFLICT`
- `TRANSACTION_NOT_FOUND`

Unexpected server failures return `500` with `INTERNAL_ERROR` and do not expose stack traces.

## 11. User experience

The tester must show:

- application health and stack name from `GET /api/health`;
- current accounts and balances;
- source and destination selectors;
- amount (BRL) and description inputs;
- asynchronous transaction status until completed or failed;
- signed account history;
- a refresh action.

The tester uses BRL presentation because the seed and MVP flow use BRL.

## 12. Acceptance criteria

1. `docker compose up --build --force-recreate` starts the complete system without manual database setup.
2. PostgreSQL, RabbitMQ, and the application become healthy.
3. Two English-named BRL seed accounts appear in the React tester.
4. A valid transfer returns `pending`, later becomes `completed`, changes both balances once, and creates exactly two entries whose sum is zero.
5. Insufficient funds produces `failed` without entries or balance changes.
6. Reprocessing the same transaction ID does not duplicate entries or balance mutations.
7. Opposite or concurrent transfers lock accounts in deterministic order.
8. API, consumer, tester, and deployment contracts have automated tests.
9. All repository code, comments, UI copy, and documentation are English.
10. README documents architecture, operation, API, reliability, tests, structure, limitations, and license.

## 13. Success metric

An evaluator can clone the repository, start it with one command, complete a transfer in the React tester, inspect RabbitMQ, query PostgreSQL-backed results, and understand the consistency model without reading every source file.
