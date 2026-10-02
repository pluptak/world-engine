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
    json = `[${value
      .map((item) => serialize(item, ancestors) ?? "null")
      .join(",")}]`;
  } else {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const item = serialize(record[key], ancestors);
        return item === undefined ? [] : [`${JSON.stringify(key)}:${item}`];
      });
    json = `{${fields.join(",")}}`;
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
