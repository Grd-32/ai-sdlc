# Queue and worker operations

## Protected status endpoint

When `QUEUE_OPERATIONS_TOKEN` is configured on the API, operators can read the
global queue snapshot at `GET /internal/operations/queue` using
`Authorization: Bearer <token>`. The endpoint is intentionally not part of an
organization dashboard: queue totals and job identifiers are platform-wide.
The token is server-only and must not be sent to a browser.

The response reports BullMQ counts, the oldest waiting job, a bounded list of
active jobs and retained failures, stalled events since the worker process
started, and the worker heartbeat. It omits job payloads and failure messages.
The worker refreshes its Redis heartbeat every ten seconds; a heartbeat older
than thirty seconds is marked stale. A missing heartbeat means the worker has
not reported since the last Redis restart/expiry or is not running.

## Recovery and reconciliation

1. Check `/health/ready` first. If PostgreSQL or Redis is unhealthy, restore the
   dependency before attempting queue recovery.
2. Read the protected queue snapshot. Record the sample time, waiting/active/
   delayed/failed counts, oldest waiting job age, worker heartbeat, and stalled
   event count. Do not copy job payloads into tickets or logs.
3. If the worker is missing or stale, inspect the worker process logs and
   container/service status. Restart only the worker service; do not flush Redis
   or delete BullMQ keys.
4. If waiting work does not drain after the worker is healthy, inspect the
   failed job count and worker error logs. Failed jobs are retained according
   to the queue's configured retention. Correct the underlying failure before
   retrying work.
5. For a webhook delivery, reconcile the persisted `GitHubWebhookEvent` row by
   provider and delivery ID. `RECEIVED` without a terminal result may indicate
   work was interrupted; `FAILED` may be safely retried through the provider's
   normal redelivery path, which reuses the delivery record and stable BullMQ
   job ID. A delivery ID with a different event type or payload hash is a
   conflict and must not be replayed as if it were the original delivery.
6. For pull-request analysis, compare the stored `lastAnalyzedSha` with the
   provider's current PR head before requesting a retry. Analysis is
   head-SHA-bound and designed to be safe to rerun for the current revision.
   Do not manually edit job payloads or mark a job complete to clear backlog.
7. After recovery, verify that the oldest waiting age is decreasing, the worker
   heartbeat is fresh, and the affected webhook/analysis state converges to the
   provider's current state. Record the delivery/PR identifiers and observed
   results, not secrets or webhook payloads.

## Validation limits

The protected snapshot and heartbeat are operational signals, not a durable
incident history. Stalled-event counts reset when the worker restarts. The
procedure should be exercised against a disposable Redis/PostgreSQL environment
before production use; this repository change does not claim that such a
recovery drill has been run.
