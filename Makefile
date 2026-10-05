# Agent Pipeline -- developer commands.
# Host targets use Node 22 via nvm when available (this repo standardizes on
# Node 22; the machine's default `node` may be older). Containers use their own.

SHELL := /bin/bash
# Activate Node 22 from nvm if present, otherwise fall back to PATH node.
NVM := if [ -s "$$HOME/.nvm/nvm.sh" ]; then . "$$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true; fi;

.DEFAULT_GOAL := help
.PHONY: help install build typecheck test clean temporal worker api web dev up down logs tf-validate

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all workspace deps (Node 22)
	$(NVM) npm ci

build: ## Build every package (tsc -b)
	$(NVM) npm run build

typecheck: ## Type-check every package
	$(NVM) npm run typecheck

test: ## Run unit + integration tests
	$(NVM) npm test

clean: ## Remove build output and local state
	$(NVM) npm run clean || true

# --- Local dev (host): Temporal CLI dev server + app processes via Node 22 ---
temporal: ## Run the Temporal dev server (UI on :8233)
	mkdir -p .temporal && temporal server start-dev --ui-port 8233 --db-filename .temporal/temporal.db --log-level warn

worker: ## Run the Temporal worker (needs Temporal running)
	$(NVM) npm run build -w @pipeline/core && npm run dev -w @pipeline/worker

api: ## Run the API server (needs Temporal running)
	$(NVM) npm run build -w @pipeline/core && npm run dev -w @pipeline/api

web: ## Run the Vite dev server
	$(NVM) npm run dev -w @pipeline/web

dev: ## One command (host): Temporal + worker + api + web together
	mkdir -p .temporal
	$(NVM) npm run build -w @pipeline/core && npx concurrently -k -n temporal,worker,api,web -c blue,green,magenta,cyan \
		"temporal server start-dev --ui-port 8233 --db-filename .temporal/temporal.db --log-level warn" \
		"npm run dev -w @pipeline/worker" \
		"npm run dev -w @pipeline/api" \
		"npm run dev -w @pipeline/web"

# --- Containers: the full stack incl. Temporal + Postgres + UI ---
up: ## One command (Docker): bring the whole stack up
	docker compose up --build

down: ## Stop containers, preserving durable state
	docker compose down

logs: ## Follow container logs
	docker compose logs -f

tf-validate: ## Validate Terraform via the hashicorp/terraform image (no local install)
	docker run --rm -v "$$PWD/infra/terraform:/wd" -w /wd hashicorp/terraform:latest init -backend=false && \
	docker run --rm -v "$$PWD/infra/terraform:/wd" -w /wd hashicorp/terraform:latest validate
