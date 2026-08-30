FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["node", "src/server.js"]
