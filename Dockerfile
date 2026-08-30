FROM node:22-alpine AS web

WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY nest-cli.json tsconfig.json ./
COPY src ./src
COPY --from=web /public ./public

RUN npx prisma generate && npx nest build

EXPOSE 3000

CMD ["node", "dist/main.js"]
