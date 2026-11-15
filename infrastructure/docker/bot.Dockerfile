FROM node:22-alpine AS base
WORKDIR /app
COPY package.json bun.lock* package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["npx", "tsx", "server.ts"]
