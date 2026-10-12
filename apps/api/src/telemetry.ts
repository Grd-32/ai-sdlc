import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

export function startTelemetry(): NodeSDK | undefined {
  const hasSharedEndpoint = Boolean(process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  const hasTraceEndpoint = hasSharedEndpoint || Boolean(process.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]);
  const hasMetricEndpoint = hasSharedEndpoint || Boolean(process.env["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"]);

  if ((!hasTraceEndpoint && !hasMetricEndpoint) || process.env["OTEL_SDK_DISABLED"] === "true") {
    return undefined;
  }

  const sdk = new NodeSDK({
    serviceName: process.env["OTEL_SERVICE_NAME"] ?? "ai-sdlc-api",
    ...(hasTraceEndpoint ? { traceExporter: new OTLPTraceExporter() } : {}),
    ...(hasMetricEndpoint
      ? {
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter(),
            }),
          ],
        }
      : {}),
  });
  sdk.start();
  return sdk;
}