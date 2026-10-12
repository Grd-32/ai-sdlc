import { readFile } from "node:fs/promises";
import { verifyAuditEventChain, type AuditEventForVerification } from "../packages/db/src/audit.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuditEvents(value: unknown): AuditEventForVerification[] {
  if (!Array.isArray(value)) {
    throw new Error("Export must contain organization.auditEvents as an array");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Audit event at index ${index} is not an object`);
    }
    const { id, organizationId, eventType, actorId, createdAt, metadata } = entry;
    if (
      typeof id !== "string" ||
      (organizationId !== null && typeof organizationId !== "string") ||
      typeof eventType !== "string" ||
      (actorId !== null && typeof actorId !== "string") ||
      typeof createdAt !== "string" ||
      !isRecord(metadata)
    ) {
      throw new Error(`Audit event at index ${index} is missing required verification fields`);
    }

    const parsedDate = new Date(createdAt);
    if (!Number.isFinite(parsedDate.getTime())) {
      throw new Error(`Audit event at index ${index} has an invalid createdAt timestamp`);
    }

    return {
      id,
      organizationId,
      eventType,
      actorId,
      createdAt: parsedDate,
      metadata,
    };
  });
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: pnpm audit:verify <organization-export.json>");
  }

  let exportValue: unknown;
  try {
    exportValue = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read or JSON parse error";
    throw new Error(`Could not read a valid JSON organization export: ${message}`);
  }

  if (!isRecord(exportValue) || !isRecord(exportValue["data"])) {
    throw new Error("Input is not an organization export");
  }
  const organization = exportValue["data"]["organization"];
  if (!isRecord(organization)) {
    throw new Error("Export does not contain data.organization");
  }

  const result = verifyAuditEventChain(parseAuditEvents(organization["auditEvents"]));
  console.log(JSON.stringify(result));
  if (!result.valid) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Audit export verification failed");
  process.exitCode = 1;
});
