// A key is quoted the same way every time it appears, and a snapshot repeats a few dozen of them
// across thousands of objects, so the quoted form is kept. Bounded, so a world with many distinct
// keys (entity ids are keys) cannot grow it without limit.
const quotedKeys = new Map<string, string>();
const QUOTED_KEYS_LIMIT = 4096;

function quoted(key: string): string {
  let text = quotedKeys.get(key);
  if (text === undefined) {
    text = JSON.stringify(key);
    if (quotedKeys.size >= QUOTED_KEYS_LIMIT) {
      quotedKeys.clear();
    }
    quotedKeys.set(key, text);
  }
  return text;
}

function serialize(value: unknown, ancestors: Set<object>): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    throw new TypeError("Cannot serialize a bigint as JSON");
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Cannot serialize a circular value");
  }

  ancestors.add(value);
  let json: string;
  if (Array.isArray(value)) {
    json = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        json += ",";
      }
      json += serialize(value[index], ancestors) ?? "null";
    }
    json += "]";
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    json = "{";
    let first = true;
    for (const key of keys) {
      const item = serialize(record[key], ancestors);
      if (item === undefined) {
        continue;
      }
      json += `${first ? "" : ","}${quoted(key)}:${item}`;
      first = false;
    }
    json += "}";
  }
  ancestors.delete(value);
  return json;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(value, new Set());
  if (json === undefined) {
    throw new TypeError("Value cannot be serialized as JSON");
  }

  return json;
}
