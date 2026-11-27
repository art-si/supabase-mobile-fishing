// WeChat's official automator remote-debug transport. Observes only our
// coordinate-free map diagnostics; does not mock APIs or write business data.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
const output = resolve('artifacts/mini-native-map-20261124/phone-debug')
await mkdir(output, { recursive: true })
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9440' })
const rows = []
let connected = false
function save() { return writeFile(resolve(output, 'events.json'), JSON.stringify({ connected, rows }, null, 2)) }
client.on('console', event => {
  const message = JSON.stringify(event)
  if (!message.includes('[DYJ_MAP]') || rows.length >= 180) return
  rows.push({ at: new Date().toISOString(), event })
  void save()
  console.log('map diagnostics', rows.length)
})
client.connection.on('Tool.onRemoteDebugConnected', async () => {
  connected = true; await save()
  console.log('phone-connected')
  await client.send('App.enableLog').catch(() => {})
})
try {
  const result = await client.send('Tool.enableRemoteDebug', { auto: false })
  const source = result.qrCode || ''
  const data = source.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
  if (!/^(iVBOR|\/9j\/)/.test(data)) throw new Error('Remote debug did not return a supported QR image')
  const path = resolve(output, 'remote-debug-qr.png')
  await writeFile(path, Buffer.from(data, 'base64'))
  console.log('qr-ready: ' + path)
  await new Promise(resolve => setTimeout(resolve, 240000))
} finally {
  await save()
  await client.disconnect()
}
