import { readFile } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicArticleSource } from '../supabase/functions/_shared/spot-publishers.ts'
import { parseShareSource, leadSourceName } from '../supabase/functions/_shared/discovery-contract.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [operation = 'validate', value = 'data/spot-source-seeds.json'] = process.argv.slice(2)
if (operation === 'bundle') {
  if (!['spot-source-sync', 'spot-source-import', 'spot-discovery'].includes(value)) throw new Error('Unknown function')
  const base = resolve(root, 'supabase/functions'), files = new Map()
  async function include(path) {
    const absolute = resolve(path)
    if (!absolute.startsWith(base + sep)) throw new Error('Dependency escapes function root')
    const name = relative(root, absolute).replaceAll('\\', '/')
    if (files.has(name)) return
    const content = await readFile(absolute, 'utf8')
    files.set(name, { name, content })
    if (absolute.endsWith('.ts')) for (const match of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) await include(resolve(dirname(absolute), match[1]))
  }
  const entrypoint_path = `supabase/functions/${value}/index.ts`
  await include(resolve(root, entrypoint_path))
  await include(resolve(base, 'deno.json'))
  console.log(JSON.stringify({ entrypoint_path, files: [...files.values()] }))
} else {
  const cities = JSON.parse(await readFile(resolve(root, 'src/domain/data/cities.json'), 'utf8')).map(city => city.name)
  const sources = JSON.parse(await readFile(resolve(root, value), 'utf8'))
  if (!Array.isArray(sources) || !sources.length || sources.length > 100) throw new Error('Expected 1–100 source URLs')
  const seen = new Set()
  for (const source of sources) {
    const parsed = publicArticleSource(source.url) || parseShareSource(source.url)
    if (!cities.includes(source.city) || !parsed || parsed.url !== source.url) throw new Error('Invalid city or noncanonical publisher URL: ' + source.url)
    const key = source.city + ':' + source.url
    if (seen.has(key)) throw new Error('Duplicate source: ' + source.url)
    seen.add(key)
  }
  if (operation === 'queue') console.log("select public.fishing_enqueue_spot_sources('" + JSON.stringify(sources).replaceAll("'", "''") + "'::jsonb);")
  else if (operation === 'validate') console.log(JSON.stringify({ sources: sources.length, cities: new Set(sources.map(s => s.city)).size, publishers: new Set(sources.map(s => leadSourceName(publicArticleSource(s.url) || parseShareSource(s.url)))).size }))
  else throw new Error('Usage: node scripts/spot-source-maintenance.mjs validate|queue [manifest] or bundle function-name')
}
