// Firestore rejects `undefined` anywhere in a payload. Our app types use
// `undefined` for "this optional field has no value" (TypeScript convention),
// so every write needs this pass before it reaches the SDK.
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === 'object' && !(value as any).toDate) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
