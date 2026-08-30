# Stack variants

ledger-core is the product name. Compose project names are `ledger-core-express-sequelize-rabbitmq` (standalone app stack in this worktree) and `ledger-core-infra` (shared infrastructure). Never rely on the directory name as the Compose project name.

This repository ships the **express-sequelize-rabbitmq** stack: Express, Sequelize, and RabbitMQ. Other variants reuse the same HTTP contract and isolation layout.

## Standalone

One Compose file runs the app plus PostgreSQL and RabbitMQ:

```bash
docker compose up --build
```

- Project name: `ledger-core-express-sequelize-rabbitmq` (`name:` in `docker-compose.yml`)
- App: http://localhost:3000
- RabbitMQ management: http://localhost:15672
- Database URL inside Compose: `postgres://ledger:ledger@postgres:5432/ledger`
- Queue: `ledger.transfers.sequelize`
- `STACK_NAME=express-sequelize-rabbitmq`

Do not run standalone Compose at the same time as the shared infra file on the same host ports.

## Parallel worktrees

Several git worktrees can run different stacks against one shared broker and database host. Worktree directories live under `~/Projects/ledger-*`.

Start shared infrastructure once:

```bash
docker compose -f docker-compose.infra.yml up -d
```

- Project name: `ledger-core-infra`
- PostgreSQL: localhost:5432 (user/password `ledger`)
- RabbitMQ: localhost:5672, management localhost:15672
- Redis: localhost:6379
- Kafka: localhost:9092

Init creates these databases when the PostgreSQL volume is new (existing names are skipped):

- `ledger_raw`
- `ledger_sequelize`
- `ledger_typeorm`
- `ledger_bullmq`
- `ledger_express_prisma`
- `ledger_kafka`

Copy `.env.parallel.example` in each worktree, then `npm start`. Ports, databases, and queues:

| Worktree path | Port | `STACK_NAME` | Database | Queue |
| --- | --- | --- | --- | --- |
| `~/Projects/ledger-core` | 3000 | `raw` | `ledger_raw` | `ledger.transfers.raw` |
| `~/Projects/ledger-express-sequelize-rabbitmq` | 3001 | `express-sequelize-rabbitmq` | `ledger_sequelize` | `ledger.transfers.sequelize` |
| `~/Projects/ledger-typeorm` | 3002 | `typeorm` | `ledger_typeorm` | `ledger.transfers.typeorm` |
| `~/Projects/ledger-bullmq` | 3003 | `bullmq` | `ledger_bullmq` | `ledger.transfers.bullmq` |
| `~/Projects/ledger-express-prisma` | 3004 | `express-prisma` | `ledger_express_prisma` | `ledger.transfers.express-prisma` |
| `~/Projects/ledger-kafka` | 3005 | `kafka` | `ledger_kafka` | `ledger.transfers.kafka` |

App host ports are 3000 through 3005.

Health loop:

```bash
for port in 3000 3001 3002 3003 3004 3005; do
  curl -sS "http://localhost:${port}/api/health"
  echo
done
```

`scripts/smoke.sh` checks one `PORT` (default 3000). `scripts/smoke-all.sh` walks 3000-3005.

`stack.manifest.json` records the current worktree identity (`composeName`, `appHostPort`, Compose services).

## Later pull requests

Five draft pull requests will add the remaining stack variants (Sequelize, TypeORM, BullMQ, Prisma, Kafka) without changing this product name or the shared infra Compose name.
