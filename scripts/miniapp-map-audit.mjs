import assert from 'node:assert/strict'

export function nativeBindings(template) {
  const surface = template.match(/<map\b[^>]*native-water-map__surface[^>]*>/)?.[0]
  assert.ok(surface, 'The compiled native map is required')
  const fields = Object.fromEntries(['longitude', 'latitude', 'scale', 'markers', 'polygons', 'polyline'].map(name =>
    [name, surface.match(new RegExp(`\\b${name}="{{(\\w+)}}"`))?.[1]]))
  fields.id = surface.match(/\bid="([^"]+)"/)?.[1]
  fields.pin = template.match(/<movable-area\b[^>]*wx:if="{{(\w+)}}"[^>]*>/)?.[1]
  assert.ok(Object.values(fields).every(Boolean), 'Missing compiled native map or draggable-pin binding')
  return fields
}

export async function mapScreenshot(client, path) {
  for (let attempt = 1; ; attempt++) {
    try { return await client.screenshot({ path }) } catch (error) {
      if (attempt >= 3 || !/timeout waiting for automator response|Timed out SDK screenshot/i.test(error.message)) throw error
    }
  }
}
