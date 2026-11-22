import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaSource, shareSources, splitSpotShareText, type SpotLead } from '../supabase/functions/_shared/discovery-contract'
import { evidenceSpotLabels, verifiedSpotLabels } from '../supabase/functions/_shared/spot-labels'
import { labelSpots } from '../supabase/functions/spot-discovery/labels'
import { discoverSpotLeads } from '../supabase/functions/spot-discovery/leads'
import { matchLeadPlace } from '../src/domain/spot-lead-place'

test('direct observations yield independent labels and avoid unsupported or prohibited claims', () => {
  assert.deepEqual(evidenceSpotLabels('清早鱼口不错。工作日人很少。岸边干净。'), {
    catch: '清早鱼口不错。',
    quiet: '工作日人很少。',
    setting: '岸边干净。'
  })
  assert.deepEqual(evidenceSpotLabels('草鱼和青鱼。鱼少。这里人少吗？岸边不干净。'), {})
  assert.deepEqual(evidenceSpotLabels('岸边干净。这里已经禁钓。鱼情好。'), {})
  assert.deepEqual(evidenceSpotLabels('早上人少。中午人很多。'), {})
  assert.deepEqual(evidenceSpotLabels('有免费停车场。适合亲子垂钓。'), {
    parking: '有免费停车场。', family: '适合亲子垂钓。'
  })
  assert.deepEqual(verifiedSpotLabels('草鱼、青鱼。', { catch: '草鱼、青鱼。' }), {})
  assert.deepEqual(verifiedSpotLabels('一上午上了十几条鲫鱼。', {
    catch: '一上午上了十几条鲫鱼。', quiet: '上午很少有人。'
  }), { catch: '一上午上了十几条鲫鱼。' })
})

test('verified location matching keeps the provider POI ID and rejects ambiguous or unrelated places', () => {
  const lead: SpotLead = {
    name: '样例园垂钓区', poiQuery: '样例园', city: '武汉市', district: '东西湖区', waterType: '钓场',
    source: { platform: 'public', url: 'https://www.wuhan.gov.cn/news.html' }, labels: {}, sourceDate: ''
  }
  const poi = { id: 'B0EXAMPLE1', name: '样例园', address: '样例路',
    longitude: 114.02, latitude: 30.58, crs: 'GCJ-02' as const, adcode: '420112' }
  const unrelated = { ...poi, name: '样例园停车场' }
  assert.equal(matchLeadPlace(lead, [unrelated, poi], '420112'), poi)
  assert.equal(matchLeadPlace(lead, [poi, { ...poi, id: 'B0EXAMPLE2' }]), undefined)
  assert.equal(matchLeadPlace(lead, [poi], '420116'), undefined)
  assert.equal(matchLeadPlace(lead, [unrelated]), undefined)
  assert.equal(matchLeadPlace(lead, [{ ...poi, latitude: 91 }]), undefined)
  assert.deepEqual(mediaSource('https://m.diaoyu.com/diaochang/wuhan/200577.html?trace=1'),
    { platform: 'media', url: 'https://m.diaoyu.com/diaochang/wuhan/200577.html', publisher: '钓鱼之家' })
  assert.equal(mediaSource('https://m.diaoyu.com.evil.test/diaochang/wuhan/200577.html'), null)
})

test('original sources resolve to unique supported content URLs', () => {
  assert.deepEqual(shareSources([
    'https://another.example/ https://www.douyin.com.evil.test/video/123',
    'https://v.douyin.com/dyjTest/?tracking=1，https://v.douyin.com/dyjTest/',
    'https://m.toutiao.com/is/dyj-test/。B站：https://www.bilibili.com/video/BVtest/?spm=1',
    'https://www.bilibili.com https://user@www.bilibili.com/video/BVbad'
  ].join('\n')), [
    { platform: 'douyin', url: 'https://v.douyin.com/dyjTest/' },
    { platform: 'toutiao', url: 'https://m.toutiao.com/is/dyj-test/' },
    { platform: 'bilibili', url: 'https://www.bilibili.com/video/BVtest/' }
  ])
})

test('spot details preserve observations and surface supported original links', () => {
  const observation = '岸边干净。\n地图备注：https://example.test/notes'
  assert.deepEqual(splitSpotShareText(observation + '\nhttps://m.toutiao.com/is/dyj-test/?trace=1'), {
    description: observation,
    sources: [{ platform: 'toutiao', url: 'https://m.toutiao.com/is/dyj-test/' }]
  })
  assert.equal(splitSpotShareText('https://v.douyin.com/dyjTest/').description, '')
})

test('Edge labels use caller-visible public descriptions and verify the model quote', async t => {
  const visible = '10000000-0000-4000-8000-000000000001'
  const hidden = '10000000-0000-4000-8000-000000000002'
  const caller = { id: visible, token: 'caller-token' }
  const credential = 'a'.repeat(64)
  let connected = true
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://fake-supabase.example',
    SUPABASE_ANON_KEY: 'fixture-api-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key'
  }
  t.mock.method(globalThis, 'fetch', async (target: string | URL, init?: RequestInit) => {
    const url = new URL(target)
    const headers = new Headers(init?.headers)
    if (url.pathname === '/rest/v1/fishing_spots') {
      assert.equal(headers.get('Authorization'), 'Bearer caller-token')
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        select: 'id,description', id: 'in.(' + visible + ',' + hidden + ')',
        audience: 'eq.public', status: 'eq.published', fishing_status: 'eq.allowed', precision: 'neq.hidden'
      })
      return Response.json([{ id: visible, description: '一上午上了十几条鲫鱼。' }])
    }
    if (url.pathname === '/rest/v1/rpc/fishing_discovery_ticket')
      return Response.json(true)
    if (url.pathname === '/rest/v1/rpc/fishing_art_ai_client_token') {
      assert.equal(headers.get('Authorization'), 'Bearer fixture-service-key')
      return Response.json(connected ? credential : null)
    }
    assert.equal(url.href, 'https://ckbftoopuyophiebamwy.supabase.co/functions/v1/ai-service')
    assert.equal(headers.get('Authorization'), 'Bearer ' + credential)
    assert.equal(headers.get('X-Art-AI-Client'), 'fishing')
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(body), ['prompt', 'input'])
    assert.deepEqual(body.input, [{ number: 1, description: '一上午上了十几条鲫鱼。' }])
    return Response.json({ model: 'selected-in-art', result: {
      items: [
        { number: 1, labels: { catch: '一上午上了十几条鲫鱼。', quiet: '岸边无人。' } },
        { number: 2, labels: { quiet: '岸边无人。' } }
      ]
    } })
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Deno')
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true, value: { env: { get: (name: string) => environment[name] } }
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Deno', original)
    else Reflect.deleteProperty(globalThis, 'Deno')
  })
  assert.deepEqual(await labelSpots(caller, [visible, hidden]), {
    mode: 'ai', items: [{ spotId: visible, labels: { catch: '一上午上了十几条鲫鱼。' } }]
  })
  await assert.rejects(labelSpots(caller, ['unsafe-id']), { message: 'INVALID_INPUT' })
  connected = false
  assert.deepEqual(await labelSpots(caller, [visible]), { mode: 'observations', items: [] })
})

test('external discovery searches social and editorial sources and retains only supported place metadata', async t => {
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://fake-supabase.example',
    SUPABASE_ANON_KEY: 'fixture-api-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    SPOT_WEB_SEARCH_API_KEY: 'fixture-search-key'
  }
  const searched: string[] = []
  let published: Awaited<ReturnType<typeof discoverSpotLeads>>['items'] = []
  const address = '武汉市东西湖区样例路8号'
  t.mock.method(globalThis, 'fetch', async (target: string | URL, init?: RequestInit) => {
    const url = new URL(target)
    if (url.pathname === '/rest/v1/rpc/fishing_list_spot_leads') {
      assert.deepEqual(JSON.parse(String(init?.body)), { city_name: '武汉市' })
      return Response.json(published)
    }
    if (url.pathname === '/rest/v1/rpc/fishing_discovery_ticket') return Response.json(true)
    if (url.pathname === '/rest/v1/rpc/fishing_art_ai_client_token') return Response.json('a'.repeat(64))
    if (url.hostname === 'api.search.brave.com') {
      const query = url.searchParams.get('q') || ''
      searched.push(query)
      return Response.json({ web: { results: query.includes('site:douyin.com') ? [
        { title: '武汉样例湖', url: 'https://www.douyin.com/video/12345',
          description: '此处禁钓。岸边干净。' }
      ] : [
        { title: '武汉样例园垂钓区', url: 'https://news.hubeidaily.net/mobile/c_12345.html',
          description: address + '。适合亲子垂钓。', page_age: '2026-10-03' }
      ] } })
    }
    assert.equal(url.href, 'https://ckbftoopuyophiebamwy.supabase.co/functions/v1/ai-service')
    const body = JSON.parse(String(init?.body))
    const [{ number }] = body.input.candidates
    return Response.json({ model: 'selected-in-art', result: { items: [{
      number, name: '样例园垂钓区', district: '东西湖区', poiQuery: '样例园', sourceAddress: address,
      longitude: 100, latitude: 40, labels: { family: '适合亲子垂钓。', quiet: '这里人少。' }
    }] } })
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Deno')
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true, value: { env: { get: (name: string) => environment[name] } }
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Deno', original)
    else Reflect.deleteProperty(globalThis, 'Deno')
  })
  const leads = await discoverSpotLeads('test-account', '武汉市')
  assert.ok(searched.some(query => query.includes('site:bilibili.com')))
  assert.ok(searched.some(query => query.includes('site:hubeidaily.net')))
  assert.deepEqual(leads.items, [{
    name: '样例园垂钓区', city: '武汉市', district: '东西湖区', poiQuery: '样例园',
    sourceAddress: address, waterType: '钓场', sourceDate: '2026-10-03',
    labels: { family: '适合亲子垂钓。' },
    source: { platform: 'media', url: 'https://news.hubeidaily.net/mobile/c_12345.html', publisher: '湖北日报' }
  }])

  published = leads.items
  delete environment.SPOT_WEB_SEARCH_API_KEY
  const searchCount = searched.length
  assert.deepEqual(await discoverSpotLeads('test-account', '武汉市'), { items: published, status: 'ready' })
  assert.equal(searched.length, searchCount)
})
