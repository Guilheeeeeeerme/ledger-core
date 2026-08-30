FROM node:22-alpine AS web

WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

ENV DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY --from=web /public ./public

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
