interface SchemaLike {
  meta?: () => Record<string, unknown> | undefined;
  unwrap?: () => unknown;
  def?: { type?: string; innerType?: unknown; out?: unknown };
}

/**
 * Unwraps optional/default/nullable/pipe wrappers and checks for asset metadata.
 * Returns "image" | "file" | null.
 */
export function getAssetType(schema: unknown): "image" | "file" | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as SchemaLike;
  const meta = s.meta?.();
  if (meta?.["x-cms-image"]) return "image";
  if (meta?.["x-cms-file"]) return "file";
  // Unwrap wrapper types (optional, default, nullable)
  if (s.def?.innerType) return getAssetType(s.def.innerType);
  // Unwrap pipe
  if (s.def?.out) return getAssetType(s.def.out);
  // Unwrap via unwrap()
  if (s.unwrap) {
    try {
      return getAssetType(s.unwrap());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Unwraps optional/default/nullable/pipe wrappers and checks for reference metadata.
 * Returns the referenced collection name or null.
 */
export function getReferenceCollection(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as SchemaLike;
  const meta = s.meta?.();
  const ref = meta?.["x-cms-reference"];
  if (typeof ref === "string") return ref;
  if (s.def?.innerType) return getReferenceCollection(s.def.innerType);
  if (s.def?.out) return getReferenceCollection(s.def.out);
  if (s.unwrap) {
    try {
      return getReferenceCollection(s.unwrap());
    } catch {
      return null;
    }
  }
  return null;
}
