# Operations Runbook

This runbook describes the repository's local Docker Compose environment. It is not a production escalation policy: production deployment topology, owners, paging targets, and recovery objectives must be supplied by the operating organization.

## Incident Record

For each incident, record the UTC start/end time, affected service and user impact, alert name, relevant request/correlation/trace IDs, observed symptoms, actions taken, and follow-up work. Do not include credentials, session cookies, webhook secrets, or source code in incident notes. Preserve relevant logs before restarting a service.

## API Availability or 5xx Alert

1. Inspect `ApiAvailabilitySloBurn` or `ApiHighServerErrorRate` in Prometheus at `http://localhost:9090/alerts` and the API panels in Grafana at `http://localhost:3002`.
2. Check container state with `docker compose ps`.
3. Check API liveness and dependency readiness:

   ```sh
   curl -i http://localhost:3001/health
   curl -i http://localhost:3001/health/ready
   ```

   `/health/ready` reports database and Redis status; it does not check the worker, GitHub, or telemetry collector.

4. Review recent service logs:

   ```sh
   docker compose logs --since=15m api postgres redis otel-collector prometheus
   ```

5. Use `X-Request-ID`, `X-Correlation-ID`, and any emitted `traceId` to connect a client report to the API JSON log and exported span. Redact identifiers before sharing them outside the response team if they can identify a customer request.
6. After preserving diagnostics and confirming the impact, a local development operator may restart only the affected service with `docker compose restart <service>`. Re-check readiness and the error-rate panel afterward. Do not use volume deletion or broad stack teardown as an incident response action.

## Telemetry Missing

1. Check `docker compose ps otel-collector prometheus grafana api` and their recent logs.
2. Check Prometheus targets at `http://localhost:9090/targets`; the `otel-collector` target should be `UP`.
3. Confirm the API has `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and the collector has its OTLP HTTP receiver on port 4318.
4. The local Collector exports traces to its debug log and metrics to Prometheus. This setup has no persistent trace backend, no Alertmanager notification receiver, and no notification/paging delivery.

## Worker or Queue Degradation

1. Check `docker compose ps worker redis` and `docker compose logs --since=15m worker redis`.
2. The worker consumes the shared `github` BullMQ queue with concurrency 5. Job defaults allow five attempts with exponential backoff. The repository does not currently expose queue-depth, stalled-job, or worker-health metrics and has no configured dead-letter/reconciliation workflow.
3. Do not delete Redis keys or manually remove jobs as a recovery step. Preserve the failing job name/ID and worker error logs, then investigate the underlying dependency or processor failure.

## Database or Redis Readiness Failure

1. Use the `checks.database` and `checks.redis` values from `/health/ready` to identify the failing dependency.
2. Check the matching Compose service state and logs with `docker compose ps` and `docker compose logs --since=15m postgres redis`.
3. Do not remove `postgres_data` or `redis_data`. The local backup/restore helper documented below is a baseline only; production data recovery requires the deployment's approved backup and disaster-recovery procedures.

## Retention Cleanup

The worker upserts a daily `privacy.retention.cleanup` scheduler when it starts. Configure global session and finalized-webhook retention with `SESSION_RETENTION_DAYS` and `WEBHOOK_RETENTION_DAYS` (defaults: 30 and 90). An organization admin may set a webhook-specific override through the retention settings API; values are 1–3650 days, and `null` restores the global default. Check worker logs for `[retention] sessionsDeleted=... webhookEventsDeleted=...`. The job does not delete in-progress webhook rows or other organization data. If the worker is stopped, cleanup does not run until a worker starts and processes the overdue scheduled job.

## Backup and Restore Readiness

The repository includes a local backup/restore helper intended for a DB recovery drill rather than a production failover procedure. Back up with:

```sh
pnpm db:backup
```

Restore a known-good SQL dump with:

```sh
pnpm db:restore -- ./backups/ai_sdlc-2026-10-09T12-00-00Z.sql
```

This is a baseline only. Production backups must be encrypted, retained according to policy, and verified before being used to recover customer data. The repository does not yet define a production snapshot schedule, restore window, or failover ownership matrix.

## Known Operational Limits

- The 99.9% 30-day availability target is provisional and the SLI is unavailable until telemetry has populated its 30-day window.
- Prometheus alert rules evaluate locally, but alerts are not sent to email, chat, or an incident-management service.
- Worker, queue, database, and outbound GitHub dependency telemetry is incomplete.
- This repository does not define on-call ownership, severity-based escalation, customer communications, backup/restore, or production recovery time objectives.
