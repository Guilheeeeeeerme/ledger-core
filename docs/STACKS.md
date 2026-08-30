# Stack variants

ledger-core is the product name. This worktree ships the **nestjs-typeorm-rabbitmq** stack. Compose project names are `ledger-core-nestjs-typeorm-rabbitmq` (standalone app stack) and `ledger-core-infra` (shared infrastructure). Never rely on the directory name as the Compose project name.

## Standalone

One Compose file runs the app plus PostgreSQL and RabbitMQ:

```bash
docker compose up --build
```

- Project name: `ledger-core-nestjs-typeorm-rabbitmq` (`name:` in `docker-compose.yml`)
- App: http://localhost:3000
- RabbitMQ management: http://localhost:15672
- Database URL inside Compose: `postgres://ledger:ledger@postgres:5432/ledger`
- Queue: `ledger.transfers.typeorm`
- `STACK_NAME=nestjs-typeorm-rabbitmq`

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

Copy `.env.parallel.example` in this worktree, then `npm run build && npm start`. This stack uses:

| Worktree path | Port | `STACK_NAME` | Database | Queue |
| --- | --- | --- | --- | --- |
| `~/Projects/ledger-nestjs-typeorm-rabbitmq` | 3002 | `nestjs-typeorm-rabbitmq` | `ledger_typeorm` | `ledger.transfers.typeorm` |

`scripts/smoke.sh` checks one `PORT` (default 3000). `scripts/smoke-all.sh` walks 3000-3005.

`stack.manifest.json` records the current worktree identity (`composeName`, `appHostPort`, Compose services).
