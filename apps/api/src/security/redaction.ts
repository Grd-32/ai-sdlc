const SENSITIVE_FIELD_NAME =
  /(secret|password|credential|authorization|private.?key|hash)|^(api.?key|access.?key|refresh.?token)$|(?:^token(?:Hash|Value|Secret)?$|Token(?:Hash|Value|Secret)?$)/i;

function isSensitiveFieldName(key: string): boolean {
  return key !== "integrityHash" && key !== "previousHash" && SENSITIVE_FIELD_NAME.test(key);
}

type RedactedJsonObject = { [key: string]: RedactedJsonValue };
type RedactedJsonValue =
  string | number | boolean | null | RedactedJsonValue[] | RedactedJsonObject;

function redactJsonObject(value: object): RedactedJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveFieldName(key))
      .map(([key, nestedValue]) => [key, redactJsonValue(nestedValue)]),
  );
}

export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveFieldName(key))
        .map(([key, nestedValue]) => [key, redactSensitiveFields(nestedValue)]),
    );
  }
  return value;
}

function redactJsonValue(value: unknown): RedactedJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (typeof value === "object") {
    return redactJsonObject(value);
  }
  throw new TypeError("Identity-provider metadata must contain only JSON values");
}

export function redactSensitiveJsonContainer(
  value: unknown,
): RedactedJsonObject | RedactedJsonValue[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return Array.isArray(value) ? value.map(redactJsonValue) : redactJsonObject(value);
}
