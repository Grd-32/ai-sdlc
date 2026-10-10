# Local Observability

The development Compose stack sends API traces and metrics through the OpenTelemetry Collector. Metrics are scraped by Prometheus and shown in the provisioned Grafana dashboard.

Start the stack with `docker compose up --build`. Open Grafana at `http://localhost:3002` (username `admin`; password defaults to `admin`, configurable with `GRAFANA_ADMIN_PASSWORD`). The API dashboard is in the Operations folder. Prometheus is available at `http://localhost:9090`.

The `ApiHighServerErrorRate` Prometheus rule fires when 5xx responses exceed 5% of requests for five minutes. It is visible in Prometheus under Alerts. This local setup does not deliver notifications to email, chat, or an incident-management system; configure an Alertmanager receiver before relying on it operationally.

The initial API availability objective is 99.9% successful non-probe requests over a rolling 30-day window. The SLI excludes `/health` and `/health/ready`; 5xx responses count as errors, while 4xx responses are treated as successful availability responses. Prometheus records the rolling SLI and alerts when the 1-hour 5xx ratio exceeds 1% for 10 minutes. These are starting operational targets, not customer commitments, and should be reviewed against service expectations before production use. Prometheus retains 45 days of samples for the SLI window.

For a non-Compose deployment, configure `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector endpoint. The API exports request count and duration with method/status attributes and server spans with W3C trace-context propagation. Avoid adding user IDs, organization IDs, raw query strings, or other sensitive/high-cardinality values to metric labels.