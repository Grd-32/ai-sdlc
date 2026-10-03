# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/github/package.json ./packages/github/
COPY packages/provenance/package.json ./packages/provenance/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/github/node_modules ./packages/github/node_modules
COPY --from=deps /app/packages/provenance/node_modules ./packages/provenance/node_modules
COPY . .

RUN pnpm --filter @ai-sdlc/db generate
RUN pnpm --filter @ai-sdlc/db build
RUN pnpm --filter @ai-sdlc/github build
RUN pnpm --filter @ai-sdlc/provenance build
RUN pnpm --filter @ai-sdlc/api build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/github/dist ./packages/github/dist
COPY --from=builder /app/packages/github/package.json ./packages/github/
COPY --from=builder /app/packages/github/node_modules ./packages/github/node_modules
COPY --from=builder /app/packages/provenance/dist ./packages/provenance/dist
COPY --from=builder /app/packages/provenance/package.json ./packages/provenance/
COPY --from=builder /app/packages/provenance/node_modules ./packages/provenance/node_modules

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]