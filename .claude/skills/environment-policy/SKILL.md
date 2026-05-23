---
name: environment-policy
description: Use when defining or reviewing development, staging, production, .env files, environment variables, secrets, logging, deployment, monitoring, or production-readiness rules for any software project
---

# Environment Policy

## Overview

Use this skill to create portable environment rules for `development`, `staging`, and `production`. The core principle is strict environment isolation plus production-safe defaults: no shared secrets, no shared write data stores, structured logs, validated config, and observable releases.

## When to Use

Use for:

- Designing project-wide environment conventions.
- Creating `.env.example`, `.env.development.example`, `.env.staging.example`, or `.env.production.example`.
- Reviewing logging, secrets, CORS, database, deployment, monitoring, or production-readiness rules.
- Turning ad-hoc config into a reusable policy/checklist.

Do not use for one-off local debugging unless the user asks to standardize the rule afterward.

## Environment Intent

| Environment | Purpose | Defaults |
|---|---|---|
| `development` | Local developer work | verbose logs, fake/sandbox data, debug tools allowed |
| `staging` | Production-like validation | JSON logs, real integrations via sandbox/staging accounts, QA/UAT |
| `production` | Real users and data | no debug, strict secrets, structured logs, monitoring, rollback |

Never let development or staging write to production databases, buckets, queues, caches, or payment/live providers.

## File Naming Rules

Commit templates only:

```txt
.env.example
.env.development.example
.env.staging.example
.env.production.example
.env.test.example
```

Keep real values local or injected by the platform:

```txt
.env
.env.local
.env.development.local
.env.staging.local
.env.production
.env.production.local
.env.test.local
```

Recommended `.gitignore`:

```gitignore
.env
.env.local
.env.*.local
.env.development.local
.env.staging.local
.env.production
.env.production.local
!.env.example
!.env.development.example
!.env.staging.example
!.env.production.example
!.env.test.example
```

## Environment Variable Naming

Use `UPPER_SNAKE_CASE` and specific prefixes:

```txt
APP_ LOG_ DATABASE_ DB_ REDIS_ CACHE_ AUTH_ JWT_ SESSION_
COOKIE_ CORS_ RATE_LIMIT_ EMAIL_ SMS_ STORAGE_ S3_ PAYMENT_
ANTHROPIC_ OPENAI_ SENTRY_ OTEL_ FEATURE_
```

Avoid vague names like `KEY`, `TOKEN`, `URL`, `SECRET`, `MODE`.

## Baseline Config

Development:

```env
APP_ENV=development
DEBUG=true
LOG_LEVEL=debug
LOG_FORMAT=pretty
RATE_LIMIT_ENABLED=false
ENABLE_API_DOCS=true
ENABLE_MOCKS=true
```

Staging:

```env
APP_ENV=staging
DEBUG=false
LOG_LEVEL=info
LOG_FORMAT=json
RATE_LIMIT_ENABLED=true
ENABLE_API_DOCS=true
API_DOCS_REQUIRE_AUTH=true
ENABLE_MOCKS=false
```

Staging:

```env
APP_ENV=staging
APP_NAME=my-service
APP_PORT=3000
APP_VERSION=replace_me
APP_BASE_URL=https://staging.example.com
DEBUG=false
LOG_LEVEL=info
LOG_FORMAT=json
DATABASE_URL=replace_me
REDIS_URL=replace_me
JWT_SECRET=replace_me
SESSION_SECRET=replace_me
CORS_ORIGINS=https://staging.example.com
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_SECONDS=60
EMAIL_PROVIDER=sandbox
EMAIL_ALLOWLIST=qa@example.com,dev@example.com
PAYMENT_MODE=test
ERROR_TRACKING_ENABLED=true
SENTRY_ENVIRONMENT=staging
ENABLE_API_DOCS=true
API_DOCS_REQUIRE_AUTH=true
ENABLE_MOCKS=false
```

Production:

```env
APP_ENV=production
DEBUG=false
LOG_LEVEL=info
LOG_FORMAT=json
RATE_LIMIT_ENABLED=true
ENABLE_API_DOCS=false
ENABLE_MOCKS=false
```

## Startup Validation Rules

Fail fast when:

- `APP_ENV` is not one of `development`, `staging`, `production`, `test`.
- Required secrets or connection strings are missing.
- Production has `DEBUG=true`.
- Production uses placeholder secrets: `replace_me`, `changeme`, `dev_secret`.
- Production uses `LOG_FORMAT=pretty`.
- Production allows wildcard CORS with credentials.
- Auth/session secrets are too short for production.

## Logging Rules

| Environment | Level | Format | Notes |
|---|---|---|---|
| development | `debug` | `pretty` | readable local debugging, stack traces allowed |
| staging | `info` | `json` | production-like logs, more diagnostic detail allowed |
| production | `info` or `warn` | `json` | structured, redacted, alertable |

Every important log should include:

```json
{
  "timestamp": "2026-05-19T10:22:31.120Z",
  "level": "info",
  "env": "production",
  "service": "my-service",
  "version": "1.4.2",
  "event": "http_request_completed",
  "requestId": "req_abc123",
  "durationMs": 241
}
```

Never log raw secrets, passwords, access tokens, refresh tokens, API keys, authorization headers, cookies, raw session IDs, JWTs, private keys, database URLs, credit cards, or sensitive PII.

Use event names, not vague strings:

```txt
user_login_failed
rate_limit_exceeded
external_api_request_failed
llm_request_completed
http_request_completed
```

## Request and Error Rules

- Generate or propagate `requestId`/`traceId` for every request.
- Return stack traces only in development.
- Production error responses should include a safe message and `requestId`, not internals.

Production error shape:

```json
{
  "error": "INTERNAL_SERVER_ERROR",
  "message": "Something went wrong",
  "requestId": "req_123"
}
```

## Secrets and Data Separation

- Use different secrets per environment.
- Use secret managers or platform env vars for production.
- Rotate secrets after suspected exposure.
- Keep databases, caches, queues, buckets, analytics properties, payment keys, and LLM keys separate per environment.
- Copying production data to staging requires anonymization/masking.

## Production-Readiness Checklist

- [ ] `.env.example` exists and contains no real secret.
- [ ] Real `.env` files are ignored.
- [ ] `APP_ENV=production`, `DEBUG=false`, `LOG_FORMAT=json`.
- [ ] Config validation fails unsafe startup states.
- [ ] No production secret is reused in staging/development.
- [ ] Structured logs include `requestId` or `traceId`.
- [ ] Logs redact secrets and sensitive PII.
- [ ] Production CORS is an explicit allowlist.
- [ ] Auth cookies are `HttpOnly` and `Secure`.
- [ ] Rate limits protect auth, public API, uploads, payments, and expensive AI/LLM endpoints.
- [ ] Health/readiness endpoints exist.
- [ ] Error tracking and monitoring are enabled.
- [ ] Database backups and rollback procedures exist.
- [ ] Migrations are tested in staging before production.
- [ ] Deploys are traceable by version or git SHA.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Committing `.env.production` with real values | Commit only `.env.production.example`; inject real values at deploy time |
| Staging shares production credentials | Create staging-specific accounts, keys, databases, buckets, queues |
| Pretty/debug logs in production | Force `LOG_FORMAT=json` and `DEBUG=false` via startup validation |
| Logging full request bodies | Log metadata; store sensitive payloads only in controlled data stores if required |
| Staging is unlike production | Make staging production-like except for scale, data sensitivity, and sandbox/live keys |
| No request correlation | Add middleware to generate and propagate `requestId`/`traceId` |

## Reusable Example Templates

Development:

```env
APP_ENV=development
APP_NAME=my-service
APP_PORT=3000
APP_VERSION=local
DEBUG=true
LOG_LEVEL=debug
LOG_FORMAT=pretty
DATABASE_URL=postgresql://user:password@localhost:5432/my_service_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev_only_secret_change_me
SESSION_SECRET=dev_only_secret_change_me
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
RATE_LIMIT_ENABLED=false
EMAIL_PROVIDER=console
PAYMENT_MODE=test
ERROR_TRACKING_ENABLED=false
ENABLE_API_DOCS=true
ENABLE_MOCKS=true
```

Production:

```env
APP_ENV=production
APP_NAME=my-service
APP_PORT=3000
APP_VERSION=replace_me
APP_BASE_URL=https://example.com
GIT_SHA=replace_me
BUILD_TIME=replace_me
DEBUG=false
LOG_LEVEL=info
LOG_FORMAT=json
DATABASE_URL=replace_me
REDIS_URL=replace_me
JWT_SECRET=replace_me
SESSION_SECRET=replace_me
CORS_ORIGINS=https://example.com
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_SECONDS=60
ERROR_TRACKING_ENABLED=true
SENTRY_ENVIRONMENT=production
ENABLE_API_DOCS=false
ENABLE_MOCKS=false
```
