# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npx prisma generate --schema=apps/backend/prisma/schema.prisma && npx nx run backend:build

# ---- Prune deps for production ----
FROM node:20-alpine AS pruner
WORKDIR /app

COPY --from=builder /app/dist/apps/backend/package.json ./
COPY --from=builder /app/dist/apps/backend/package-lock.json ./
RUN npm install --omit=dev --ignore-scripts

# ---- Runtime ----
FROM node:20-alpine AS runner
WORKDIR /app

# Install ffmpeg + yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip curl openssl && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    yt-dlp --version

COPY --from=builder /app/dist/apps/backend/main.js ./
COPY --from=builder /app/apps/backend/prisma ./prisma/
COPY --from=pruner /app/node_modules ./node_modules/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Storage directories
RUN mkdir -p storage/vods storage/clips storage/thumbnails

ENV NODE_ENV=production
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy --schema ./prisma/schema.prisma && node main.js"]
