# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/github/package.json ./packages/github/
COPY packages/risk/package.json ./packages/risk/
COPY packages/policy/package.json ./packages/policy/
COPY packages/security/package.json ./packages/security/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/github/node_modules ./packages/github/node_modules
COPY --from=deps /app/packages/risk/node_modules ./packages/risk/node_modules
COPY --from=deps /app/packages/policy/node_modules ./packages/policy/node_modules
COPY --from=deps /app/packages/security/node_modules ./packages/security/node_modules
COPY . .

RUN pnpm --filter @ai-sdlc/db generate
RUN pnpm --filter @ai-sdlc/db build
RUN pnpm --filter @ai-sdlc/github build
RUN pnpm --filter @ai-sdlc/risk build
RUN pnpm --filter @ai-sdlc/policy build
RUN pnpm --filter @ai-sdlc/security build
RUN pnpm --filter @ai-sdlc/worker build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/github/dist ./packages/github/dist
COPY --from=builder /app/packages/github/package.json ./packages/github/
COPY --from=builder /app/packages/github/node_modules ./packages/github/node_modules
COPY --from=builder /app/packages/risk/dist ./packages/risk/dist
COPY --from=builder /app/packages/risk/package.json ./packages/risk/
COPY --from=builder /app/packages/risk/node_modules ./packages/risk/node_modules
COPY --from=builder /app/packages/policy/dist ./packages/policy/dist
COPY --from=builder /app/packages/policy/package.json ./packages/policy/
COPY --from=builder /app/packages/policy/node_modules ./packages/policy/node_modules
COPY --from=builder /app/packages/security/dist ./packages/security/dist
COPY --from=builder /app/packages/security/package.json ./packages/security/
COPY --from=builder /app/packages/security/node_modules ./packages/security/node_modules

WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]