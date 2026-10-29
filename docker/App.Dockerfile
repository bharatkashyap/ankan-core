FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS build
ARG VITE_CONVEX_URL
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_MCP_ORIGIN
ARG VITE_TELEGRAM_BOT_USERNAME
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
ENV VITE_MCP_ORIGIN=${VITE_MCP_ORIGIN}
ENV VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME}
RUN pnpm build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

FROM deps AS deploy
CMD ["node", "docker/deploy.mjs"]
