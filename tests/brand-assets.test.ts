import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FISHING_SKINS } from '../src/domain/appearance'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path))
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const manifest = JSON.parse(read('assets/brand/generated-manifest.json').toString()) as {
  source: string
  sourceSha256: string
  palettesSha256: string
  outputs: Array<{ path: string; width: number; height: number; sha256: string }>
}

test('brand exports match the canonical fish and all six theme palettes', () => {
  assert.equal(
    hash(read(manifest.source)),
    manifest.sourceSha256,
    'run pnpm brand:generate after editing the vector'
  )
  const palettes = FISHING_SKINS.map(({ id, light, dark }) => [
    id,
    light.lake,
    dark.lake,
    light.reed,
    dark.reed
  ])
  assert.equal(
    hash(JSON.stringify(palettes)),
    manifest.palettesSha256,
    'regenerate theme-colored fish after palette changes'
  )
  assert.equal(new Set(manifest.outputs.map((x) => x.path)).size, manifest.outputs.length)
  for (const output of manifest.outputs) {
    const png = read(output.path)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', output.path)
    assert.equal(png.readUInt32BE(16), output.width, output.path)
    assert.equal(png.readUInt32BE(20), output.height, output.path)
    assert.equal(
      hash(png),
      output.sha256,
      `${output.path}: regenerate, do not edit a derived bitmap independently`
    )
  }
})

test('every theme, state and native launcher uses the same exported identity', () => {
  const paths = new Set(manifest.outputs.map((x) => x.path))
  for (const skin of FISHING_SKINS)
    for (const mode of ['light', 'dark'])
      for (const tone of ['brand', 'muted'])
        for (const layer of ['body', 'tail'])
          assert.ok(paths.has(`src/static/brand/fish-${skin.id}-${mode}-${tone}-${layer}.png`))
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'])
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground'])
      assert.ok(paths.has(`android/app/src/main/res/mipmap-${density}/${name}.png`))
  assert.ok(paths.has('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))
  const catalog = JSON.parse(
    read('ios/App/App/Assets.xcassets/Splash.imageset/Contents.json').toString()
  )
  for (const entry of catalog.images)
    assert.ok(paths.has(`ios/App/App/Assets.xcassets/Splash.imageset/${entry.filename}`))
  const svg = read(manifest.source).toString()
  assert.equal((svg.match(/<circle\b/g) || []).length, 4, 'one eye and three conversation dots')
  assert.ok(svg.includes('id="fish-tail"') && svg.includes('id="fish-body"'))
})
