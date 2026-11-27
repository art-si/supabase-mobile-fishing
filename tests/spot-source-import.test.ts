import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { createSpotSourceImportHandler } from '../supabase/functions/spot-source-import/handler'
import type { SpotLead } from '../supabase/functions/_shared/discovery-contract'
import { sharedLeadPlace } from '../src/domain/spot-lead-place'

const name = '潮声路亚基地'
const city = '武汉市'
const sourceLinks = [
  'https://www.douyin.com/video/100001',
  'https://www.toutiao.com/w/100002',
  'https://www.bilibili.com/video/BV1Source/'
]
const posts = sourceLinks.map((url, index) => ({
  url,
  title: name,
  excerpt: index === 0 ? '武汉市江夏区潮声路亚基地。这里可以船钓。有免费停车场。'
    : '潮声路亚基地可以船钓。',
  location: '武汉市江夏区样例路6号',
  poiName: name,
  publishedOn: '2026-11-20'
}))
const blocked = { ...posts[0]!, url: 'https://www.douyin.com/video/100003', excerpt: name + '已禁钓。' }

test('stages three platform shares with Art evidence, restricted writes and idempotent sources without claiming publication', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema fishing_private; grant usage on schema fishing_private to service_role;
      create function public.fishing_store_spot_lead_point(text,text,double precision,double precision) returns void language sql as $$select$$;`)
    for (const migration of ['20261121051141_fishing_public_spot_leads.sql', '20261121101747_fishing_publish_shared_spots.sql', '20261123030929_fishing_spot_source_pipeline.sql', '20261123033038_fishing_spot_source_place_hints.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'))
    }
    const secret = 'fixture-service-key'
    let analyses = 0
    let staged: SpotLead[] = []
    const handler = createSpotSourceImportHandler({
      loadAi: async token => token !== secret ? null : async (_prompt, input, validate) => {
        analyses++
        const { candidates } = input as { candidates: { number: number; description: string }[] }
        assert.ok(candidates.every(candidate => !candidate.description.includes('已禁钓')))
        return validate({
          items: candidates.map(candidate => ({
            number: candidate.number,
            name: '样例公园',
            evidence: '可以船钓',
            district: '江夏区',
            sourceAddress: '武汉市江夏区样例路6号',
            labels: { parking: '有免费停车场。', quiet: '非常少人' },
            longitude: 120,
            latitude: 40
          }))
        })
      },
      publish: async (items, token) => {
        staged = items
        assert.equal(token, secret)
        await db.exec('set role service_role')
        try {
          return (await db.query<{ published: number }>(
            'select public.fishing_publish_spot_leads($1::jsonb) as published', [JSON.stringify(items)]
          )).rows[0]!.published
        } finally { await db.exec('reset role') }
      }
    })
    const send = (key: string, body: object) => handler(new Request('https://example.test/spot-source-import', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(body)
    }))
    assert.equal((await send('fixture-user-key', { city, posts })).status, 401)
    assert.equal((await send(secret, { city, posts: [{ ...posts[0], url: 'https://example.test/video/100001' }] })).status, 400)
    assert.equal(analyses, 0)
    const preview = await send(secret, { city, posts: [...posts, blocked], preview: true })
    assert.equal(preview.status, 200)
    const previewResult = await preview.json()
    assert.equal(previewResult.published, 0)
    assert.equal(previewResult.items.length, 1)

    const imported = await send(secret, { city, posts: [...posts, blocked] })
    assert.equal(imported.status, 200)
    const importedResult = await imported.json()
    assert.equal(importedResult.published, 0)
    assert.equal(importedResult.queued, 3)
    assert.equal((await (await send(secret, { city, posts })).json()).queued, 0)
    const fourth = { ...posts[0]!, url: 'https://www.douyin.com/video/100004?share=tracking' }
    assert.equal((await (await send(secret, { city, posts: [fourth] })).json()).queued, 1)

    const spot = staged[0]!
    assert.deepEqual(spot.labels, { parking: '有免费停车场。' })
    assert.equal(spot.sourceAddress, '武汉市江夏区样例路6号')
    assert.equal(spot.poiQuery, name)
    assert.equal(spot.sourceDate, '2026-11-20')
    assert.equal('longitude' in spot, false)
    const queued = await db.query<{ url: string }>('select url from fishing_private.spot_source_jobs where url=any($1)', [[...sourceLinks, 'https://www.douyin.com/video/100004']])
    assert.equal(queued.rows.length, 4)

    await db.exec('set role anon')
    try {
      const { rows } = await db.query<{ items: SpotLead[] }>('select public.fishing_list_spot_leads($1) as items', [city])
      assert.deepEqual(rows[0]!.items, [])
      await assert.rejects(db.query('select public.fishing_publish_spot_leads($1::jsonb)', ['[]']), /permission denied/i)
    } finally { await db.exec('reset role') }
  } finally {
    await db.close()
  }
})

test('imports public wild fishing posts with verified POIs or attached coordinates', async () => {
  const position = { longitude: 114.03, latitude: 30.58, crs: 'GCJ-02' as const }
  const river = {
    url: 'https://t.bilibili.com/123456789012345678',
    excerpt: '下竿就钓到两条鲫鱼。岸边干净。',
    poiName: '样例河西岸',
    location: '武汉市东西湖区样例河西岸',
    sourcePosition: position
  }
  const reservoir = {
    url: river.url,
    title: '武汉江夏区的样例水库南岸',
    excerpt: '在样例水库南岸野钓鲫鱼。',
    poiName: '样例水库南岸',
    poiQuery: '样例水库南门'
  }
  const published: SpotLead[] = []
  const handler = createSpotSourceImportHandler({
    loadAi: async () => async (_prompt, input, validate) => {
      const { candidates } = input as { candidates: { number: number; description: string }[] }
      assert.ok(candidates.every(candidate => !('sourcePosition' in candidate)))
      return validate({ items: candidates.map(({ number }) => ({
        number,
        name: number === 1 ? '编造的地点' : '样例水库南岸',
        evidence: ['下竿就钓到两条鲫鱼', '野钓鲫鱼', '野钓鲫鱼', '想找野钓鲫鱼的位置'][number - 1],
        labels: { setting: '岸边干净' },
        sourcePosition: { longitude: 120, latitude: 40, crs: 'WGS84' }
      })) })
    },
    publish: async items => published.push(...items)
  })
  const send = (posts: object[]) => handler(new Request('https://example.test/spot-source-import', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-service-key' }, body: JSON.stringify({ city, posts })
  }))
  const ambiguous = { ...reservoir, url: 'https://www.toutiao.com/w/100006', poiName: undefined, poiQuery: undefined }
  const question = { ...reservoir, url: 'https://www.toutiao.com/w/100007', excerpt: '想找野钓鲫鱼的位置' }
  const response = await send([river, reservoir, ambiguous, question])
  assert.equal(response.status, 200)
  assert.deepEqual(published.map(spot => [spot.name, spot.waterType]), [
    ['样例河西岸', '自然水域'], ['样例水库南岸', '水库']
  ])
  const [lead, lake] = published
  assert.equal(lead!.source.url, 'https://www.bilibili.com/opus/123456789012345678')
  assert.deepEqual(lead!.sourcePosition, position)
  assert.equal(lake!.poiQuery, '样例水库南门')
  assert.equal('sourcePosition' in lake!, false)
  assert.deepEqual(sharedLeadPlace(lead!), {
    id: 'share:114.030000,30.580000', name: river.poiName, address: river.location, source: 'share', ...position
  })
  const converted = sharedLeadPlace({ ...lead!, sourcePosition: { ...position, crs: 'WGS84' } })!
  assert.equal(converted.crs, 'GCJ-02')
  assert.notEqual(converted.longitude, position.longitude)
  assert.equal((await send([{ ...river, sourcePosition: { ...position, latitude: 95 } }])).status, 400)
})
