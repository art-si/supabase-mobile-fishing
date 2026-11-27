// Development previews only. Keep a bounded, memory-only trace so a phone can
// inspect it through development tools without adding product-facing controls.
const build = 'map-native-20261124-r4'
const started = Date.now()
const rows: Record<string, unknown>[] = []
const allowed = new Set(['action', 'version', 'current', 'found', 'distance', 'geometry', 'coarse', 'accuracyM',
  'phase', 'cause', 'scale', 'gesture', 'publish', 'nativeScale', 'eventScale', 'boundScale', 'centerChanged',
  'type', 'valid', 'changed', 'boundary', 'resized', 'tapRadius', 'zoom'])
let firstLocation: Record<string, unknown> | undefined
export function isMapDiagnosticAvailable() {
  try { return uni.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch { return false }
}
export function traceMap(event: string, data: Record<string, unknown> = {}) {
  try {
    if (!isMapDiagnosticAvailable()) return
    // Explicit allowlist: coordinates, names, accounts, URLs and tokens cannot
    // accidentally enter a diagnostic when another call site adds a field.
    const safe = Object.fromEntries(Object.entries(data).filter(([key, value]) => allowed.has(key) &&
      ['string', 'number', 'boolean'].includes(typeof value)))
    const row = { ms: Date.now() - started, event, ...safe }
    rows.push(row)
    if (rows.length > 180) rows.shift()
    if (event === 'first-location') firstLocation = row
    console.info('[DYJ_MAP]', event, JSON.stringify(safe))
  } catch { /* Other platforms and isolated tests do not have WeChat metadata. */ }
}
export function mapDiagnostics() {
  return isMapDiagnosticAvailable() ? JSON.stringify({ build, firstLocation, rows }) : ''
}
