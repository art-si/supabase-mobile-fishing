// Collect only named, reviewed government sources. No inferred shoreline or city-wide ban.
// A new jurisdiction needs its own policy and coordinate source in this registry.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { clipToWater } from './water-mask.mjs'
import { wgs84ToGcj02 } from '../src/_mobile-core/coordinates.ts'
import {
  boundaryAnchor,
  boundaryBounds,
  validReportBoundary,
  validOfficialZoneBoundary
} from '../src/domain/zone-geometry.ts'
const boundarySource = 'https://yyj.moa.gov.cn/bjwj/201904/t20190419_6197404.htm'
const nationalPolicy =
  'https://cjjjd.ndrc.gov.cn/gongzuodongtai/quanweifabu/guanfangfabu/202112/t20211227_1310752.htm'
const hubeiPolicy =
  'https://nyt.hubei.gov.cn/zfxxgk/zc_GK2020/gfxwj_GK2020/202607/t20260715_5977199.shtml'
const jiangsuPolicy = 'https://www.jsrd.gov.cn/qwfb/sjfg/202606/t20260603_1335317.shtml'
const candidates = [
  [
    6,
    '宜兴团氿东氿翘嘴鲌',
    '江苏省无锡市宜兴市团氿',
    '320282',
    jiangsuPolicy,
    '江苏省人大常委会',
    '2026-05-27'
  ],
  [
    15,
    '圣水湖黄颡鱼',
    '湖北省十堰市竹山县圣水湖',
    '420323',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2026-07-15'
  ],
  [
    16,
    '琵琶湖细鳞斜颌鲴',
    '湖北省随州市随县琵琶湖',
    '421321',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2026-07-15'
  ],
  [
    17,
    '富水湖鲌类',
    '湖北省咸宁市通山县富水湖',
    '421224',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2025-12-26'
  ],
  [
    18,
    '金沙湖鲂',
    '湖北省黄冈市红安县金沙湖',
    '421122',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2026-07-15'
  ],
  [
    19,
    '胭脂湖黄颡鱼',
    '湖北省荆州市石首市胭脂湖',
    '421081',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2026-07-15'
  ],
  [
    20,
    '东港湖黄鳝',
    '湖北省荆州市监利市东港湖',
    '421088',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2025-12-26'
  ],
  [
    21,
    '南湖黄颡鱼乌鳢',
    '湖北省荆门市钟祥市南湖',
    '420881',
    hubeiPolicy,
    '湖北省农业农村厅',
    '2026-07-15'
  ]
]
await mkdir('data/official-zones', { recursive: true })
let html
if (process.argv.includes('--cached'))
  html = await readFile('artifacts/map-fences/sources/moa-eighth.html', 'utf8')
else {
  const response = await fetch(boundarySource, { signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw Error(`Government coordinate source returned ${response.status}`)
  html = await response.text()
}
const text = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .normalize('NFKC')
  .replaceAll('′′', '"')
const coordinate =
  /(\d{2,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]\s*E\s*[,，;；]\s*(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]\s*N/g
const records = [],
  excluded = []
const refreshedSources = []
let previousVerified = []
try {
  previousVerified = JSON.parse(
    await readFile('data/official-zones/verified.json', 'utf8')
  ).records.filter((row) => row.published && row.provenance?.water_verified)
} catch {
  /* First collection has no prior verified surfaces. */
}
for (const [number, name, label, adcode, policy, issuer, issued] of candidates) {
  const section = text.match(
    new RegExp(`(?:^|\\n)[　\\s]*${number}[.]${name}[\\s\\S]*?(?=\\n[　\\s]*${number + 1}[.]|$)`)
  )?.[0]
  if (!section) throw Error(`Missing reviewed section ${name}`)
  const core = section.match(
    /(?:核心区[^。]*?由|核心区[^。]*?是由)[\s\S]*?(?=实验区|核心区之外|保护区主要保护对象)/
  )?.[0]
  const count = core?.match(/由\s*(\d+)\s*个拐点/)?.[1]
  const matches = [...(core || '').matchAll(coordinate)]
  if (!count || matches.length !== Number(count)) {
    excluded.push({
      name,
      reason: '公告拐点数量或格式无法核对，未绘制',
      found: matches.length,
      expected: count
    })
    continue
  }
  const original = matches.map((m) => [
    Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600,
    Number(m[4]) + Number(m[5]) / 60 + Number(m[6]) / 3600
  ])
  const path = original.map(([lng, lat]) => wgs84ToGcj02(lng, lat).map((n) => Number(n.toFixed(6))))
  path.push([...path[0]])
  const boundary = { type: 'Polygon', coordinates: [path] }
  if (!validReportBoundary(boundary, 1000000)) {
    excluded.push({ name, reason: '公告坐标顺序不能形成有效水域多边形，未绘制' })
    continue
  }
  const anchor = boundaryAnchor(boundary)
  records.push({
    id: `moa-eighth-${number}-core`,
    title: `${name}保护区 · 核心区`,
    description: `此处为${label}的国家级水产种质资源保护区核心区。适用属地禁钓规定；围栏仅收录农业农村部公告中可以核对的核心区拐点，未将整个湖泊、实验区或行政区推定为禁钓区。范围内禁止垂钓，以属地最新公告和现场界标为准。`,
    location_label: label,
    region_adcode: adcode,
    longitude: anchor[0],
    latitude: anchor[1],
    boundary,
    published: false,
    water_attribution: '',
    water_source_url: '',
    issuer,
    source_url: policy,
    boundary_source_url: boundarySource,
    boundary_note:
      '围栏依据官方公告的水域拐点绘制，经纬度转换为高德显示坐标；拐点间以公告指定水域为准，不是测绘级岸线。',
    issued_on: policy === hubeiPolicy ? '2025-12-26' : issued,
    checked_on: '2026-11-20',
    valid_from: policy === hubeiPolicy ? '2025-12-26' : issued,
    valid_until: policy === hubeiPolicy ? '2027-12-25' : null,
    provenance: {
      coordinate_source_date: '2015-06-11',
      original_geographic_points: original,
      legal_fallback: nationalPolicy,
      bounds: boundaryBounds(boundary)
    }
  })
}
if (process.argv.includes('--water')) {
  const ready = []
  const names = { 6: '团氿', 15: '圣水湖', 16: '琵琶湖', 19: '胭脂湖', 21: '南湖' }
  // Named equivalence verified in the original local interview. No nearest-water inference.
  const identities = { 16: { aliases: ['大洪山水库'], source_url: 'https://news.hubeidaily.net/mobile/c_2009223.html', note: '随县水利部门访谈说明琵琶湖为大洪山水库；仍只截取部公告核心区与水面交集。' } }
  for (const row of records) {
    try {
      const surfaces = []
      const number = Number(row.id.split('-')[2])
      const original = row.provenance.original_geographic_points
      const water = await clipToWater(row.id, names[number], original.concat([original[0]]), identities[number])
      for (const [index, part] of water.polygons.entries()) {
        const boundary = {
          type: 'Polygon',
          coordinates: part.map((ring) =>
            ring.map(([lng, lat]) => wgs84ToGcj02(lng, lat).map((v) => Number(v.toFixed(6))))
          )
        }
        if (!validOfficialZoneBoundary(boundary)) {
          excluded.push({
            name: row.title,
            reason: '水面交集过小或边界无法通过验证，未公开',
            component: index + 1
          })
          continue
        }
        const anchor = boundaryAnchor(boundary)
        surfaces.push({
          ...row,
          id: row.id + '-water-' + (index + 1),
          boundary,
          longitude: anchor[0],
          latitude: anchor[1],
          published: true,
          water_attribution: '© OpenStreetMap contributors',
          water_source_url: water.provenance.url,
          boundary_note:
            '围栏为公告核心区与已核对水面的交集，保留岛屿等非水面空洞；水面参考 OpenStreetMap，不是测绘级岸线。以当地最新公告和现场界标为准。',
          provenance: {
            ...row.provenance,
            water: water.provenance,
            water_verified: true,
            bounds: boundaryBounds(boundary)
          }
        })
      }
      if (!surfaces.length) throw Error('水面交集未通过验证；保留上次已核验版本，等待复核。')
      ready.push(...surfaces)
      refreshedSources.push(row.id)
    } catch (error) {
      const retained = previousVerified.filter((previous) =>
        previous.id.startsWith(row.id + '-water-')
      )
      if (retained.length) {
        ready.push(
          ...retained.map((previous) => ({
            ...previous,
            provenance: { ...previous.provenance, refresh_issue: error.message }
          }))
        )
        continue
      }
      ready.push({
        ...row,
        provenance: { ...row.provenance, water_verified: false, review_reason: error.message }
      })
    }
  }
  records.splice(0, records.length, ...ready)
}
await writeFile(
  'data/official-zones/verified.json',
  JSON.stringify(
    {
      checked_on: '2026-11-20',
      coverage:
        '按全国地图范围查询。公告坐标仅为待核验资料；必须与可核实水面边界相交后才可公开，不代表全国目录完整。',
      records,
      excluded
    },
    null,
    2
  ) + '\n'
)
const columns = [
  'id',
  'title',
  'description',
  'location_label',
  'region_adcode',
  'longitude',
  'latitude',
  'boundary',
  'issuer',
  'source_url',
  'boundary_source_url',
  'boundary_note',
  'issued_on',
  'checked_on',
  'valid_from',
  'valid_until',
  'published',
  'water_attribution',
  'water_source_url'
]
const types = [
  'text',
  'text',
  'text',
  'text',
  'text',
  'float8',
  'float8',
  'jsonb',
  'text',
  'text',
  'text',
  'text',
  'date',
  'date',
  'date',
  'date',
  'boolean',
  'text',
  'text'
]
const rows = records.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])))
const json = JSON.stringify(rows).replaceAll("'", "''")
const currentIds = rows
  .filter((row) => row.published)
  .map((row) => "'" + row.id.replaceAll("'", "''") + "'")
  .join(',')
const managedPrefixes = refreshedSources
  .map((id) => "'" + id.replaceAll("'", "''") + "-water-%'")
  .join(',')
const outputIndex = process.argv.indexOf('--migration-output')
const output =
  outputIndex >= 0 ? process.argv[outputIndex + 1] : 'artifacts/map-fences/official-zone-import.sql'
if (!output) throw Error('Specify an empty CLI-created migration after --migration-output')
if (outputIndex >= 0) {
  const target = resolve(output),
    migrations = resolve('supabase/migrations')
  if (
    dirname(target) !== migrations ||
    !(await stat(target)).isFile() ||
    (await stat(target)).size !== 0
  )
    throw Error('Import requires an empty CLI-created migration; never overwrite deployed history')
}
await mkdir(dirname(output), { recursive: true })
await writeFile(
  output,
  '-- Reviewed government announcements; natural source IDs make imports idempotent.\n' +
    `insert into public.fishing_official_zones(${columns.join(',')})\nselect ${columns.join(',')} from jsonb_to_recordset('${json}'::jsonb) as r(${columns.map((c, i) => `${c} ${types[i]}`).join(',')})\non conflict(id) do update set ${columns
      .filter((c) => c !== 'id')
      .map((c) => `${c}=excluded.${c}`)
      .join(',')};\n` +
    `update public.fishing_official_zones set published=false where id like any(array[${managedPrefixes}]::text[]) and id <> all(array[${currentIds}]::text[]);\n`
)
console.log(
  JSON.stringify(
    {
      imported: records.map((r) => ({
        title: r.title,
        region: r.region_adcode,
        vertices: r.boundary.coordinates[0].length - 1
      })),
      excluded
    },
    null,
    2
  )
)
