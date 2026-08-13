function canonicalizeValue(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Sync payload numbers must be finite')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Sync payloads must not contain cycles')
    seen.add(value)
    const result = `[${value.map((entry) => canonicalizeValue(entry, seen)).join(',')}]`
    seen.delete(value)
    return result
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (seen.has(object)) throw new TypeError('Sync payloads must not contain cycles')
    seen.add(object)
    const result = `{${Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(object[key], seen)}`)
      .join(',')}}`
    seen.delete(object)
    return result
  }
  throw new TypeError(`Unsupported sync payload value: ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return canonicalizeValue(value, new Set())
}
