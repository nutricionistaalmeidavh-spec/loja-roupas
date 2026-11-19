FROM node:22-bookworm-slim AS workspace
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
COPY infra/sql ./infra/sql
RUN pnpm --filter @loja/api... --filter @loja/web... install --frozen-lockfile

FROM workspace AS api
USER node
CMD ["node", "--experimental-strip-types", "apps/api/src/main.ts"]

FROM workspace AS web-build
RUN pnpm --filter @loja/web build

FROM caddy:2-alpine AS web
COPY --from=web-build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
