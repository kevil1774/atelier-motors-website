FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/

RUN npm ci --omit=dev


FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apk update && \
    apk upgrade --no-cache && \
    rm -rf /var/cache/apk/*

COPY --from=deps /app/node_modules ./node_modules
COPY backend/package*.json ./backend/
COPY backend/ ./

RUN rm -rf \
        /usr/local/lib/node_modules/npm \
        /usr/local/lib/node_modules/corepack \
        /opt/yarn-v1.22.22 \
        /usr/local/bin/npm \
        /usr/local/bin/npx \
        /usr/local/bin/corepack \
    && \
    addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    mkdir -p /app/uploads && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server.js"]