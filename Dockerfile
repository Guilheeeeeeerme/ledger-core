FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY nest-cli.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npx prisma generate && npx nest build

EXPOSE 3005

CMD ["node", "dist/main.js"]
