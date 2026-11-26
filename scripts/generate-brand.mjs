import { chromium } from 'playwright'
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FISHING_SKINS } from '../src/domain/appearance.ts'

// All bitmap deliverables are renders of this vector, never independent drawings.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(root, 'assets/brand/fish-symbol.svg'), 'utf8')
const previewOnly = process.argv.includes('--preview')
const palettes = FISHING_SKINS.map(({ id, light, dark }) => [
  id,
  light.lake,
  dark.lake,
  light.reed,
  dark.reed
])
const outputs = []
const hash = (content) => createHash('sha256').update(content).digest('hex')
const glyph = (color, layer = 'all') =>
  source
    .replace('style="color:#0f6b5b"', `style="color:${color}"`)
    .replace(
      '</svg>',
      `${layer === 'all' ? '' : `<style>#fish-${layer === 'body' ? 'tail' : 'body'}{display:none}</style>`}</svg>`
    )
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function render(path, width, height, html, background = 'transparent') {
  const target = resolve(root, path)
  mkdirSync(dirname(target), { recursive: true })
  await page.setViewportSize({ width, height })
  await page.setContent(
    `<html><head><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:${background}}svg{display:block;width:100%;height:100%}</style></head><body>${html}</body></html>`
  )
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: target, omitBackground: background === 'transparent' })
  if (!path.startsWith('artifacts/'))
    outputs.push({ path, width, height, sha256: hash(readFileSync(target)) })
}
const centered = (color, width = '72%') =>
  `<div style="width:${width};height:100%;margin:auto;display:flex;align-items:center">${glyph(color)}</div>`
try {
  // This board is for optical checking, not an application screen.
  await render(
    'artifacts/fish-review/fish-v2-proof.png',
    1200,
    720,
    `
    <div style="font-family:'Microsoft YaHei',sans-serif;color:#182d27;padding:48px">
      <div style="display:flex;gap:64px;align-items:center">
        <div style="width:300px;height:300px;border-radius:64px;background:#0f6b5b">${centered('#ffffff', '78%')}</div>
        <div><div style="width:400px;height:240px">${glyph('#0f6b5b')}</div><div style="font-size:46px;font-weight:700;letter-spacing:4px;text-align:center">钓友集</div></div>
      </div>
      <div style="display:flex;gap:48px;align-items:center;margin-top:68px">
        ${[20, 28, 44, 80, 120].map((size) => `<div style="text-align:center"><div style="width:${size}px;height:${size * 0.6}px;margin:auto">${glyph('#0f6b5b')}</div><div style="font-size:13px;margin-top:20px;color:#53665f">${size}px</div></div>`).join('')}
        <div style="width:240px;height:128px;border-radius:24px;padding:24px;background:#111c19">${glyph('#79ceb8')}</div>
      </div>
    </div>`,
    '#f5f7f5'
  )
  if (!previewOnly) {
    // Retain the previous artwork once, before replacing the deliverables.
    for (const file of ['logo-horizontal.png', 'miniapp-avatar.png', 'miniapp-avatar-master.png']) {
      const old = resolve(root, 'assets/brand', file)
      const backup = resolve(root, 'assets/brand/archive-v1', file)
      if (existsSync(old) && !existsSync(backup)) {
        mkdirSync(dirname(backup), { recursive: true })
        copyFileSync(old, backup)
      }
    }
    for (const [skin, light, dark, mutedLight, mutedDark] of palettes) {
      for (const [mode, color, muted] of [
        ['light', light, mutedLight],
        ['dark', dark, mutedDark]
      ]) {
        for (const [tone, paint] of [
          ['brand', color],
          ['muted', muted]
        ]) {
          for (const layer of ['body', 'tail']) {
            await render(
              `src/static/brand/fish-${skin}-${mode}-${tone}-${layer}.png`,
              640,
              384,
              glyph(paint, layer)
            )
          }
        }
      }
    }
    await render('assets/brand/fish-symbol.png', 1600, 960, glyph('#0f6b5b'))
    for (const [path, size] of [
      ['assets/brand/miniapp-avatar.png', 1024],
      ['assets/brand/miniapp-avatar-master.png', 2048],
      ['src/static/brand/apple-touch-icon.png', 180],
      ['src/static/brand/favicon.png', 64],
      ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024]
    ])
      await render(path, size, size, centered('#ffffff', '78%'), '#0f6b5b')
    // Use the same glyph and the installed project font family for a transparent lockup.
    for (const [path, width, height] of [
      ['assets/brand/logo-horizontal.png', 1728, 576],
      ['src/static/web/brand/logo-horizontal.png', 864, 288]
    ]) {
      await render(
        path,
        width,
        height,
        `<div style="height:100%;display:flex;gap:${width * 0.025}px;align-items:center;justify-content:center;color:#0f6b5b"><div style="width:34%;height:80%">${glyph('#0f6b5b')}</div><span style="font-family:'Microsoft YaHei',sans-serif;font-size:${width * 0.15}px;line-height:1;font-weight:700;letter-spacing:${width * 0.012}px">钓友集</span></div>`
      )
    }
    const res = 'android/app/src/main/res'
    for (const [density, size, foreground] of [
      ['mdpi', 48, 108],
      ['hdpi', 72, 162],
      ['xhdpi', 96, 216],
      ['xxhdpi', 144, 324],
      ['xxxhdpi', 192, 432]
    ]) {
      await render(
        `${res}/mipmap-${density}/ic_launcher.png`,
        size,
        size,
        centered('#fff', '78%'),
        '#0f6b5b'
      )
      await render(
        `${res}/mipmap-${density}/ic_launcher_round.png`,
        size,
        size,
        `<div style="height:100%;border-radius:50%;background:#0f6b5b">${centered('#fff', '78%')}</div>`
      )
      await render(
        `${res}/mipmap-${density}/ic_launcher_foreground.png`,
        foreground,
        foreground,
        centered('#fff', '58%')
      )
    }
    // Keep existing canvas dimensions, so no native layout/configuration changes are needed.
    const nativeSplashes = readdirSync(resolve(root, res))
      .filter((x) => x.startsWith('drawable') && !x.includes('night'))
      .map((x) => `${res}/${x}/splash.png`)
      .filter((x) => existsSync(resolve(root, x)))
    for (const file of nativeSplashes) {
      const buffer = readFileSync(resolve(root, file))
      const width = buffer.readUInt32BE(16),
        height = buffer.readUInt32BE(20)
      await render(
        file,
        width,
        height,
        centered('#0f6b5b', `${Math.round(Math.min(width, height) * 0.2)}px`),
        '#f5f7f5'
      )
      const night = file.replace(
        /drawable(-port|-land)?(?=-|\/)/,
        (_, orientation = '') => `drawable${orientation}-night`
      )
      await render(
        night,
        width,
        height,
        centered('#79ceb8', `${Math.round(Math.min(width, height) * 0.2)}px`),
        '#111c19'
      )
    }
    for (const file of [
      'splash-2732x2732.png',
      'splash-2732x2732-1.png',
      'splash-2732x2732-2.png'
    ]) {
      await render(
        `ios/App/App/Assets.xcassets/Splash.imageset/${file}`,
        2732,
        2732,
        centered('#0f6b5b', '240px'),
        '#f5f7f5'
      )
      await render(
        `ios/App/App/Assets.xcassets/Splash.imageset/${file.replace('.png', '-dark.png')}`,
        2732,
        2732,
        centered('#79ceb8', '240px'),
        '#111c19'
      )
    }
    writeFileSync(
      resolve(root, 'assets/brand/generated-manifest.json'),
      JSON.stringify(
        {
          source: 'assets/brand/fish-symbol.svg',
          sourceSha256: hash(source),
          palettesSha256: hash(JSON.stringify(palettes)),
          outputs
        },
        null,
        2
      ) + '\n'
    )
  }
  console.log(
    previewOnly
      ? 'Fish silhouette proof rendered.'
      : 'Generated fish identity, themed layers, logo, avatar and native assets from fish-symbol.svg.'
  )
} finally {
  await browser.close()
}
