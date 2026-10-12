---
id: TICKET-0006
title: Inbound GitHub App Webhook Gateway & Event Ingestion Subsystem
status: ready-for-review
priority: P1
area: webhooks / integrations
created: 2026-10-12
---

# TICKET-0006: Inbound GitHub App Webhook Gateway

## Summary
Provide an enterprise-grade inbound webhook ingestion gateway at `/api/webhooks/github` to support automated GitHub Apps, CI/CD runners, and autonomous code review bots (such as Greptile and visual QA agents).

## Requirements
- Constant-time HMAC-SHA256 verification using `crypto.timingSafeEqual`.
- Delivery deduplication via `X-GitHub-Delivery` caching with 24-hour TTL in Redis.
- Structured event router dispatching `ping`, `pull_request`, `issue_comment`, `check_run`, etc.
- Health check and discovery endpoint at `GET /api/webhooks/github`.
- Comprehensive test coverage for replay attacks, tampering, and valid event processing.
