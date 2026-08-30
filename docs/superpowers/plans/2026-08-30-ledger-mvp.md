# Ledger Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task by task. This document records the completed implementation path.

**Goal:** Build a browser-observable ledger whose transfer path crosses an HTTP API, RabbitMQ, a consumer, and PostgreSQL while preserving double-entry invariants.

**Architecture:** One Node.js process serves the API and dashboard and runs the RabbitMQ consumer. PostgreSQL stores transactions, entries, and account balances. `ledgerService` owns financial validation, locking, idempotency, and atomic persistence so transport code contains no accounting policy.

**Tech stack:** Node.js 22, CommonJS JavaScript, Express, `pg`, `amqplib`, PostgreSQL 16, RabbitMQ 3 Management, HTML/CSS/browser JavaScript, Node test runner, and Docker Compose.

**Specification:** `docs/PRD.md`

## Global constraints

- The complete product runs with `docker compose up --build`.
- Monetary values are integer minor units; domain logic never uses floating-point amounts.
- Every completed transfer has exactly two entries whose sum is zero.
- Processing is idempotent by transaction UUID.
- A broker message is acknowledged only after durable processing.
- Inline comments explain non-obvious decisions rather than narrating syntax.
- The MVP excludes ORM, authentication, frontend frameworks, and requirements outside the PRD.

## Task 1 — Transfer domain

**Files:** `package.json`, `src/domain/validateTransfer.js`, `test/validateTransfer.test.js`

**Interface:** `validateTransfer(input)` returns a normalized payload or throws `DomainError` with `code` and HTTP `status`.

- [x] Write failing tests for valid normalization, non-positive amounts, unsafe or fractional amounts, equal account IDs, malformed UUIDs, and missing fields.
- [x] Implement the minimal domain validator and structured errors.
- [x] Run the focused and full test suites.

## Task 2 — Atomic persistence

**Files:** `src/db.js`, `src/schema.sql`, `src/ledgerService.js`, `test/ledgerService.test.js`

**Interfaces:** `createPendingTransfer`, `processTransfer`, `markFailed`, `getTransaction`, `listAccounts`, and `listAccountHistory`.

- [x] Test deterministic account lock order, balanced entries, idempotency, insufficient funds, rollback, and PostgreSQL bigint delta casts.
- [x] Implement transaction wrapper with `BEGIN`, `COMMIT`, `ROLLBACK`, and guaranteed client release.
- [x] Add schema constraints, history index, and idempotent seed accounts.
- [x] Implement sorted `SELECT ... FOR UPDATE`, validations, entries, balance projection updates, and status transitions.

## Task 3 — Broker and API

**Files:** `src/broker.js`, `src/consumer.js`, `src/app.js`, `src/server.js`, `test/api.test.js`, `test/consumer.test.js`

**Interfaces:** durable `publishTransfer(transactionId)`, `startConsumer`, `handleMessage`, and the PRD HTTP routes.

- [x] Test `202`, validation errors, account and history queries, unknown transactions, and static delivery.
- [x] Test `ack` after success, permanent failure recording plus `ack`, and transient `nack` with requeue.
- [x] Implement durable queue assertion and persistent messages.
- [x] Implement consumer acknowledgement policy.
- [x] Implement API routes, dependency injection, error mapping, and startup retries.

## Task 4 — Observable dashboard

**Files:** `public/index.html`, `public/styles.css`, `public/app.js`

- [x] Add an HTTP contract test for the dashboard and browser script.
- [x] Implement account cards, transfer form, flow visualization, status polling, signed history, and responsive layout.
- [x] Keep presentation dependency-free and use `Intl.NumberFormat` for BRL.

## Task 5 — Containers and documentation

**Files:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `README.md`, `docs/PRD.md`, `LICENSE`, `test/deployment.test.js`, `test/documentation.test.js`

- [x] Define application, PostgreSQL, and RabbitMQ services with health checks.
- [x] Apply schema and seed before starting the consumer.
- [x] Document startup, architecture, API, reliability, tests, structure, limitations, and license.
- [x] Enforce English-only repository prose and documentation sections with tests.
- [x] Validate Compose configuration and run the complete stack.
- [x] Submit a real transfer and verify two entries with net zero.
- [x] Resubmit the same ID and verify no duplicate balance mutation or entry.

## Completion evidence

- Full automated suite passed with zero failures.
- All three Compose services reported healthy.
- The dashboard and health endpoint were reachable.
- Integrated transfer status became `completed`.
- PostgreSQL showed exactly two entries and a net amount of zero.
- Reusing the transaction ID preserved balances and entry count.
