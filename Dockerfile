# syntax=docker/dockerfile:1
# Multi-stage build for the worker and the api (which also serves the built SPA).
# Installing and building inside the image guarantees native deps (the Temporal
# core bridge) match the container platform.

# ---- build: install workspaces and compile everything ----
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci
COPY . .
RUN npm run build && npm run build -w @pipeline/web

# ---- worker runtime ----
FROM node:22-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["node", "packages/worker/dist/worker.js"]

# ---- api runtime (serves /api and the built SPA on the same origin) ----
FROM node:22-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
EXPOSE 3001
COPY --from=build /app ./
CMD ["node", "packages/api/dist/server.js"]
