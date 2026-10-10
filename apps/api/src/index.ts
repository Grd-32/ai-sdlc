import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { closeQueueConnections } from "./queue.js";
import { getPort } from "./config.js";
import { startTelemetry } from "./telemetry.js";

const telemetry = startTelemetry();
const port = getPort();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down...`);
  await closeQueueConnections();
  server.close();
  await telemetry?.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
