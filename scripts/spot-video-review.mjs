import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseShareSource, readSpotSharePosition } from '../supabase/functions/_shared/discovery-contract.ts'
import { sourceSafety } from '../supabase/functions/_shared/spot-source-verification.ts'

const [action, file] = process.argv.slice(2)
if (!['frame', 'publish'].includes(action) || !file) throw Error('Usage: spot-video-review.mjs frame|publish <review.json>')
const input = JSON.parse(await readFile(file, 'utf8'))
const { card, reviewedOn, title, frame } = input
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const source = parseShareSource(card.source.url)
if (today !== reviewedOn || !source || source.url !== card.source.url || source.platform !== card.source.platform ||
    card.source.kind !== '视频' || !title || !card.evidence ||
    sourceSafety({ source, title, screeningText: card.evidence, publishedOn: card.sourceDate }))
  throw Error('Check the original video, its identity, current access and review date')
if (!/^[\p{Script=Han}]{2,20}$/u.test(card.city) || !card.district || !card.poiQuery || !/^[A-Za-z0-9]{5,40}$/.test(card.poiId))
  throw Error('Missing verified city, district or map POI')
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const frameBucket = 'fishing-catch-frames'
if (frame) {
  if (!Number.isInteger(frame.seconds) || frame.seconds < 0 || frame.seconds > 86400 || !frame.description?.trim() ||
      frame.description.length > 100 || !/^[\w.-]+\.jpg$/i.test(frame.file)) throw Error('Invalid frame details')
  const bytes = await readFile(resolve(dirname(file), frame.file))
  if (bytes.length > 256 * 1024 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)
    throw Error('The catch frame must be a JPEG up to 256 KiB')
  const { seconds, description } = frame
  const sourceUrl = source.url
  card.catchFrame = { key: createHash('sha256').update(bytes).digest('hex') + '.jpg', sourceUrl, seconds, description }
  if (action === 'frame') {
    const payload = { sourceUrl, seconds, description, jpeg: bytes.toString('base64') }
    console.log(`select net.http_post(url:='https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/spot-source-sync/catch-frame',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (select decrypted_secret from vault.decrypted_secrets where name='fishing_spot_source_worker')),
      body:=${json(payload)},timeout_milliseconds:=30000) as request_id;`)
    process.exit(0)
  }
} else if (action === 'frame') throw Error('No inspected catch frame in this review')

const key = process.env.AMAP_WEB_SERVICE_KEY
const expected = readSpotSharePosition(card.sourcePosition)
if (!key || !expected || expected.crs !== 'GCJ-02') throw Error('Amap credentials and a GCJ-02 reference point are required')
async function lookup(route, params) {
  const url = new URL('https://restapi.amap.com/v3/' + route)
  url.search = new URLSearchParams({ key, ...params }).toString()
  const data = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).json()
  if (data.status !== '1') throw Error('Amap verification failed: ' + data.info)
  return data
}
const matches = poi => poi?.id === card.poiId && poi.name === card.poiQuery && typeof poi.location === 'string' &&
  poi.location.split(',').length === 2 && poi.location.split(',').every((n, i) =>
    Math.abs(Number(n) - [expected.longitude, expected.latitude][i]) < 0.000015)
const detail = await lookup('place/detail', { id: card.poiId, extensions: 'base' })
const exact = detail.pois?.some(p => matches(p) && p.cityname === card.city && p.adname === card.district)
if (!exact) {
  await new Promise(resolve => setTimeout(resolve, 1200))
  const near = (await lookup('geocode/regeo', { location: expected.longitude + ',' + expected.latitude, extensions: 'all', radius: '100' })).regeocode
  const region = near?.addressComponent
  if (!(region?.city === card.city || region?.province === card.city) || region.district !== card.district ||
      !near.pois?.some(matches)) throw Error('The public map does not confirm this exact POI, point and district')
}
card.reviewMethod = 'original_video'
card.videoEvidence = { ...card.videoEvidence, title }
console.log(`do $review$
declare c jsonb:=${json(card)}; j fishing_private.spot_source_jobs; token uuid:=gen_random_uuid();
begin
  if not exists(select 1 from fishing_private.spot_source_jobs where city=c->>'city' and url=c->'source'->>'url') then
    perform public.fishing_enqueue_spot_sources(jsonb_build_array(jsonb_build_object('city',c->>'city','url',c->'source'->>'url')));
  end if;
  select * into strict j from fishing_private.spot_source_jobs where city=c->>'city' and url=c->'source'->>'url' for update;
  if j.lease_until>now() or j.reason in ('fishing_restriction','prohibited_location','venue_closed','source_http_404','source_http_410') then
    raise exception 'SOURCE_BUSY_OR_WITHDRAWN';
  end if;
  if public.fishing_spot_creation_check((c->'sourcePosition'->>'longitude')::float8,
    (c->'sourcePosition'->>'latitude')::float8)->>'blocked' is distinct from 'false' then raise exception 'PROHIBITED_LOCATION'; end if;
  if c ? 'catchFrame' and not exists(select 1 from storage.objects where bucket_id='${frameBucket}' and name=c->'catchFrame'->>'key') then
    raise exception 'UPLOAD_FRAME_FIRST';
  end if;
  if exists(select 1 from public.fishing_spot_leads l where l.city=j.city and l.card->'source'->>'url'=j.url and
      l.catalog_status='published' and fishing_private.spot_lead_place_key(l.card) is distinct from fishing_private.spot_lead_place_key(c)) then
    raise exception 'SOURCE_HAS_ANOTHER_PUBLISHED_LOCATION';
  end if;
  update fishing_private.spot_source_jobs set state='processing',lease=token,lease_until=now()+interval '5 minutes' where id=j.id;
  if not public.fishing_finish_spot_source(j.id,token,jsonb_build_object('state','published','cards',jsonb_build_array(c))) then
    raise exception 'SOURCE_CONFLICT';
  end if;
end $review$;`)

