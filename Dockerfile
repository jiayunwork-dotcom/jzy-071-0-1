# syntax=docker/dockerfile:1
# ---------- 构建阶段 ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 利用层缓存：先复制工作区清单
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/
COPY packages/server/package.json ./packages/server/

RUN npm ci || npm install

# 复制全部源码并构建：core 类型 -> web 静态产物 -> server 单文件 bundle
COPY tsconfig.base.json ./
COPY packages ./packages
# core 仅需类型产物（运行时被 server 直接 bundle）
RUN npm run build -w @fem2d/core \
  && npm run build -w @fem2d/web \
  && npm run build -w @fem2d/server

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_DIST=/app/web/dist

# 仅复制后端 bundle 与前端静态产物（无需 node_modules：server 已自包含）
COPY --from=build /app/packages/server/dist/server.mjs ./server.mjs
COPY --from=build /app/packages/web/dist ./web/dist

EXPOSE 8080
# 容器内 server.mjs 的目录为 /app，静态目录默认 /app/web/dist
CMD ["node", "server.mjs"]
