# Load Testing and Performance Baseline

This milestone introduces a lightweight performance baseline for the local environment and a documented set of expectations for production-scale growth.

## Objectives

- validate that the API remains responsive under burst concurrency
- establish a repeatable local-performance smoke test
- identify bottlenecks before scaling the application beyond the monolith phase
- document capacity assumptions and guardrails for production planning

## Current load-test entry point

The repo includes a simple concurrency-based load script at `scripts/load-test.mjs`.

```bash
LOAD_TEST_URL=http://localhost:3001 LOAD_TEST_PATH=/health LOAD_TEST_REQUESTS=100 LOAD_TEST_CONCURRENCY=10 node ./scripts/load-test.mjs
```

The script sends N HTTP requests concurrently, tracks status codes and latency, and prints a summary in JSON. It is intentionally lightweight and should be used for local or staging validation only.

## Recommended scenarios

### 1. Liveness and readiness smoke

- endpoint: `/health` and `/health/ready`
- expected: 200/healthy response under moderate concurrency
- goal: detect dependency regressions before broader traffic testing

### 2. Authenticated dashboard access pattern

- endpoint: `/api/organizations/:organizationId/overview`
- workload: normal admin/viewer user requests with realistic concurrency
- goal: verify that RBAC checks and tenant filtering do not create hot spots

### 3. Webhook ingestion burst test

- endpoint: `/api/webhooks/github`
- workload: spike of valid and invalid webhook signatures to measure queue pressure
- goal: validate that ingestion remains bounded and that queue retries do not runaway under a burst

### 4. Bulk listing / analyst reads

- endpoint: list endpoints such as `/api/organizations/:organizationId/pull-requests`
- workload: page size and filter combinations that exercise Prisma query paths
- goal: identify N+1 behavior and query-time scaling risks

## Acceptance criteria

For a local or staging load test, treat the run as acceptable when:

- success rate stays above 99% for the tested workload
- median latency remains within the expected p95 bound for the current environment
- no unbounded memory growth or worker saturation appears during the run
- Redis or PostgreSQL errors are not hidden behind retry storms or silent 5xx responses

## Guardrails

- Do not run large-scale load tests against customer-owned environments without approval.
- Keep test data isolated from production records.
- Record concurrency, request count, payload size, and infrastructure sizing in the test report.
- Use the load test results to refine the capacity model rather than as a production certification artifact.

## Performance follow-up

Once the app is on a production-grade deployment topology, extend the benchmark with:

- p95/p99 latency tracking across API and worker paths
- Redis queue depth and worker saturation metrics
- database query timing and Prisma explain analysis
- autoscaling thresholds and alerting rules

