// Read-only public API timing. Never print keys, sessions, coordinates or response bodies.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
const env = Object.fromEntries((await readFile('.env.local', 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2].trim()]))
if (env.VITE_SUPABASE_URL !== 'https://jupuypvmgjpnpntfetqv.supabase.co' ||
    !env.VITE_SUPABASE_KEY?.startsWith('sb_publishable_')) throw new Error('Confirmed project and public key required')
const observations = []
for (const action of ['feed', 'spots', 'spots']) {
  const body = JSON.stringify({ action, payload: {} })
  const args = ['--silent', '--show-error', '--max-time', '20', '--output', 'NUL',
    '--write-out', '%{json}', '--request', 'POST', '--header', 'Content-Type: application/json',
    '--data-binary', body, '--config', '-']
  const result = await new Promise(resolve => {
    const process = spawn('curl.exe', args, { windowsHide: true })
    let stdout = ''
    process.stdout.on('data', chunk => { stdout += chunk })
    process.stderr.resume()
    process.on('close', code => resolve({ code, stdout }))
    process.stdin.end(`url = "${env.VITE_SUPABASE_URL}/rest/v1/rpc/fishing_read"\nheader = "apikey: ${env.VITE_SUPABASE_KEY}"\n`)
  })
  let timing = {}
  try { timing = JSON.parse(result.stdout) } catch { /* No diagnostics are printed. */ }
  const entry = { action, exitCode: result.code, status: timing.http_code || 0,
    dnsMs: Math.round((timing.time_namelookup || 0) * 1000),
    connectMs: Math.round((timing.time_connect || 0) * 1000),
    tlsMs: Math.round((timing.time_appconnect || 0) * 1000),
    firstByteMs: Math.round((timing.time_starttransfer || 0) * 1000),
    totalMs: Math.round((timing.time_total || 0) * 1000) }
  observations.push(entry)
  console.log(JSON.stringify(entry))
}
await mkdir('artifacts/network', { recursive: true })
await writeFile('artifacts/network/public-api-latency.json', JSON.stringify({ checkedAt: new Date().toISOString(),
  mode: 'live-anonymous-read-only', project: 'jupuypvmgjpnpntfetqv', observations }, null, 2))
