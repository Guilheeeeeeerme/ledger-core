# Stack variants

ledger-core is the product name. Never rely on the directory name as the Compose project name.

This checkout is the **nestjs-prisma-bullmq** stack: NestJS, Prisma, Redis, and BullMQ. Compose project name: `ledger-core-nestjs-prisma-bullmq`.

## Operator flow

Switch to the stack branch you want to test. One Compose project brings the React tester, the HTTP API, and that branch's Postgres plus broker.

```bash
git checkout <branch>
docker compose up --build --force-recreate
```

Open http://localhost:3000 and exercise the ledger in the React app. Health shows `{ status, stack }` from `GET /api/health`.

When finished:

```bash
docker compose down -v
```

Do not run two stack branches at the same time on one host. Every stack binds port `3000`.

## This branch

- Branch: `stack/nestjs-prisma-bullmq`
- Compose name: `ledger-core-nestjs-prisma-bullmq`
- App: http://localhost:3000
- Redis: localhost:6379
- `STACK_NAME=nestjs-prisma-bullmq`
- Queue: `ledger.bullmq`

## Other stack branches

- `main` — Compose name `ledger-core`
- `stack/express-sequelize-rabbitmq` — Compose name `ledger-core-express-sequelize-rabbitmq`
- `stack/nestjs-typeorm-rabbitmq` — Compose name `ledger-core-nestjs-typeorm-rabbitmq`
- `stack/nestjs-prisma-bullmq` — Compose name `ledger-core-nestjs-prisma-bullmq`
- `stack/express-prisma-rabbitmq` — Compose name `ledger-core-express-prisma-rabbitmq`
- `stack/nestjs-prisma-kafka` — Compose name `ledger-core-nestjs-prisma-kafka`

`stack.manifest.json` records the current stack identity (`composeName`, Compose services).
