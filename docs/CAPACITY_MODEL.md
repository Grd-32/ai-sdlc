# Capacity Model and Sizing Assumptions

## Purpose

This document captures the current baseline capacity assumptions for the AI-SDLC control plane and defines the minimum sizing evidence needed before a production pilot.

## Current architecture assumptions

The repository currently runs as a modular monolith with:

- API service (`apps/api`) serving dashboard and admin endpoints
- worker service (`apps/worker`) processing BullMQ jobs and background tasks
- PostgreSQL for durable relational state
- Redis for queueing and session/cache support
- optional local observability stack for telemetry

This is a valid MVP topology for a single-region pilot, but it is not yet a horizontally scaled production platform.

## Baseline capacity assumptions

The following numbers should be treated as a starting estimate rather than a guarantee.

### Small pilot deployment

- API: 2 vCPU / 4 GB RAM
- Worker: 2 vCPU / 4 GB RAM
- PostgreSQL: 2 vCPU / 8 GB RAM
- Redis: 1 vCPU / 2 GB RAM

Expected capacity for a pilot environment:

- moderate daily developer and admin traffic
- low to medium webhook volume
- single region, single environment
- limited concurrency per organization

### Moderate production pilot

- API: 4 vCPU / 8 GB RAM, scaled horizontally with 2-3 replicas
- Worker: 4 vCPU / 8 GB RAM with queue partitioning or separate job groups
- PostgreSQL: 4 vCPU / 16 GB RAM with connection pooling and tuning
- Redis: 2 vCPU / 4 GB RAM with persistence enabled

Expected capacity for a moderate production pilot:

- stronger concurrent dashboard demand
- higher webhook event rates and queue backlog
- more complex policy and audit queries
- active retention cleanup and export activity

## Scaling model

Use the following relationships when estimating capacity:

1. API capacity is driven by request concurrency and query duration.
2. Worker capacity is driven by queue depth, processor runtime, and retry/backoff behavior.
3. Database capacity is driven by per-tenant data volume, index efficiency, and connection utilization.
4. Redis capacity depends on queue depth, session load, and job housekeeping.

A conservative rule of thumb for a single-region pilot is:

- keep API concurrency below the point where p95 latency exceeds the acceptable target
- keep queue depth under the configured backlog threshold before autoscaling triggers
- keep PostgreSQL connection usage bounded with a pooling layer and query review

## Operational measurements to track

- API p95 and p99 latency
- worker task latency and retries
- queue depth and backlog age
- database query timing and lock waits
- Redis memory usage and eviction metrics
- error rate by route and status code

## Production readiness thresholds

Any production deployment should establish:

- SLOs for availability and latency
- autoscaling thresholds for API and worker instances
- queue dead-letter and backlog policy
- alerting on queue depth, 5xx rate, and DB saturation
- a clear rollback plan if sustained latency or queue buildup occurs

## Current limitation

The current repo includes operational telemetry and retention scheduling, but it does not yet define a formal production autoscaling, alerting, or traffic model. This document should be treated as a baseline planning artifact until the deployment team confirms the true production environment and retention pattern.
