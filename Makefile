# Hilltide: one entry point for the web app and the data pipeline.
# Run `make help` for the list of targets.

.DEFAULT_GOAL := help
.PHONY: help setup check check-web check-pipeline build size e2e dev clean

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

setup: ## Install web and pipeline dependencies
	cd web && npm ci
	cd pipeline && uv sync

check: check-web check-pipeline ## Lint, typecheck and unit-test everything

check-web: ## Lint, typecheck and unit-test the web app
	cd web && npm run check

check-pipeline: ## Lint and test the data pipeline
	cd pipeline && uv run ruff format --check . && uv run ruff check . && uv run pytest

build: ## Build the site into web/dist and check its size
	cd web && npm run build
	node scripts/check-site-size.mjs web/dist

size: ## Check the built site against its size limits
	node scripts/check-site-size.mjs web/dist

e2e: build ## Headless browser tests against the built site (saves screenshots)
	cd web && npm run e2e

dev: ## Start the dev server
	cd web && npm run dev

clean: ## Remove build and test output (never touches data/raw)
	rm -rf web/dist web/test-results web/playwright-report
