#!/usr/bin/env node

const baseUrl = process.env.LOAD_TEST_URL ?? "http://localhost:3001";
const path = process.env.LOAD_TEST_PATH ?? "/health";
const totalRequests = Number(process.env.LOAD_TEST_REQUESTS ?? 50);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 10);
const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS ?? 15000);

const url = new URL(path, baseUrl).toString();

if (!Number.isFinite(totalRequests) || totalRequests < 1) {
  throw new Error("LOAD_TEST_REQUESTS must be a positive integer");
}
if (!Number.isFinite(concurrency) || concurrency < 1) {
  throw new Error("LOAD_TEST_CONCURRENCY must be a positive integer");
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
  throw new Error("LOAD_TEST_TIMEOUT_MS must be at least 1000");
}

const start = Date.now();
const results = [];
const queue = Array.from({ length: totalRequests }, (_, index) => index);

async function performRequest(index) {
  const requestId = `load-test-${index}-${Date.now()}`;
  const requestStarted = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-Request-ID": requestId },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const requestFinished = performance.now();
    results.push({
      index,
      ok: response.ok,
      status: response.status,
      latencyMs: Number((requestFinished - requestStarted).toFixed(2)),
    });
  } catch (error) {
    const requestFinished = performance.now();
    results.push({
      index,
      ok: false,
      status: 0,
      latencyMs: Number((requestFinished - requestStarted).toFixed(2)),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run() {
  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) break;
        await performRequest(next);
      }
    })());
  }

  await Promise.all(workers);

  const totalLatency = results.reduce((sum, result) => sum + result.latencyMs, 0);
  const okCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - okCount;
  const durationMs = Date.now() - start;
  const rps = (results.length / Math.max(durationMs / 1000, 0.001)).toFixed(2);

  const summary = {
    url,
    totalRequests: results.length,
    concurrency,
    durationMs,
    reqPerSecond: Number(rps),
    successfulRequests: okCount,
    failedRequests: failedCount,
    averageLatencyMs: results.length ? Number((totalLatency / results.length).toFixed(2)) : 0,
    statusCounts: Object.fromEntries(
      Object.entries(
        results.reduce((acc, result) => {
          acc[result.status] = (acc[result.status] ?? 0) + 1;
          return acc;
        }, {}),
      ).sort(([a], [b]) => Number(a) - Number(b)),
    ),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

await run();
