<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import FishingEmptyState from '@/components/FishingEmptyState.vue'
import MobileSkeleton from '@mobile-core/components/MobileSkeleton.vue'
import { distanceMeters } from '@mobile-core/coordinates'
import SpotCard from './SpotCard.vue'
import SpotCommentsSheet from './SpotCommentsSheet.vue'
import { useSpotCommunity } from '@/composables/useSpotCommunity'
import { leadCommunityKey, spotCommunityKey } from '@/services/spot-community'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { read } from '@/services/repository'
import type { Page, Spot } from '@/domain/models'
import type { MapPlace } from '@/domain/map'
import { entryPosition, retryEntryLocation } from '@/services/entry-location'
import { fishingDistanceOrigin, fishingMapPoint } from '@/domain/place-distance'
// #ifdef H5
import { describeSpotLocation } from '@/platforms/spot-location'
// #endif
import { cityOption } from '@/domain/cities'
import { onContentDeleted } from '@/services/content-deletion'
import { classifyVisibleSpots, loadPublicSpotLeads, loadSpotLeadPlace } from '@/services/discovery'
import type { LeadSource, SpotLabels, SpotLead } from '../../supabase/functions/_shared/discovery-contract'
import { evidenceSpotLabels, mentionsFishingRestriction, verifiedSpotLabels } from '../../supabase/functions/_shared/spot-labels'
const auth = useAuthStore()
const currentCity = ref('')
const locationCity = ref('')
const listCity = ref('')
const origin = computed(() => {
  const point = entryPosition.value
  if (!point) return null
  const coords = fishingDistanceOrigin(point)
  return coords ? { longitude: coords[0], latitude: coords[1], crs: point.crs } : null
})
const canSearch = computed(() => Boolean(origin.value))
const outsideCoverage = computed(() => {
  const point = entryPosition.value
  return Boolean(point && !fishingMapPoint(point.longitude, point.latitude))
})
const locating = ref(false)
const locationTitle = computed(() => {
  if (locating.value) return '正在重新定位'
  return outsideCoverage.value ? '当前位置超出检索范围' : '定位精度不足'
})
const locationDescription = computed(() => outsideCoverage.value
  ? '可按地名查看其他地区的水域。'
  : '到开阔处重试，或按地名查找水域。')
async function relocate() {
  if (locating.value) return
  locating.value = true
  try { await retryEntryLocation() } finally { locating.value = false }
}
let locationVersion = 0, labelsVersion = 0, leadsVersion = 0, placesVersion = 0
onScopeDispose(() => {
  locationVersion++
  labelsVersion++
  leadsVersion++
  placesVersion++
})
function rememberCity() {
  currentCity.value = cityOption(String(uni.getStorageSync('dyj.feed.city') || ''))?.name || ''
}
rememberCity()
async function refresh() {
  rememberCity()
  more.error.value = ''
  await Promise.all([refreshLeads(), refreshCommunity(), load()])
}
const query = ref(''),
  submitted = ref(''),
  type = ref('')
const hasFilters = computed(() => Boolean(submitted.value.trim() || type.value))
function spotPage(cursor: string | null) {
  const point = origin.value
  const filters = { query: submitted.value, type: type.value, cursor }
  if (!point) return Promise.resolve({ items: [], next: null } as Page<Spot>)
  const approximate = auth.signedIn ? point : {
    ...point,
    longitude: Math.round(point.longitude / .02) * .02,
    latitude: Math.round(point.latitude / .02) * .02
  }
  return read<Page<Spot>>('spots', {
    ...filters, origin: approximate
  })
}
watch(
  () => auth.context,
  () => {
    listCity.value = ''
    query.value = ''
    submitted.value = ''
  },
  { flush: 'sync' }
)
const { data, loading, error, load, invalidate } = useResource(() => spotPage(null), {
  items: [], next: null
})
const more = useMutation()
let active = true
onHide(() => { active = false })
onShow(() => { active = true })
onContentDeleted(value => {
  if (value.type !== 'spot') return
  const reload = loading.value
  invalidate()
  data.value = { ...data.value, items: data.value.items.filter(spot => spot.id !== value.id) }
  if (reload && active) void load()
})
const searchScope = computed(() => JSON.stringify([auth.context, query.value, submitted.value, type.value, origin.value]))
watch(searchScope, () => { more.error.value = '' }, { flush: 'sync' })
async function loadMore() {
  const previous = data.value, scope = searchScope.value
  if (!previous.next || loading.value || error.value || query.value.trim() !== submitted.value.trim()) return
  await more.run(async () => {
    try {
      const page = await spotPage(previous.next)
      if (data.value !== previous || searchScope.value !== scope || loading.value) return
      const ids = new Set(previous.items.map(spot => spot.id))
      data.value = { items: [...previous.items, ...page.items.filter(spot => !ids.has(spot.id))], next: page.next }
    } catch (cause) {
      if (data.value === previous && searchScope.value === scope) throw cause
    }
  })
}
function reachBottom() {
  if (!more.error.value) void loadMore()
}
watch(origin, (point, previous) => {
  if (point?.longitude === previous?.longitude && point?.latitude === previous?.latitude) return
  if (previous !== undefined) void load()
  locationCity.value = ''
  const version = ++locationVersion
  if (!point) return
  // #ifdef H5
  void describeSpotLocation({ ...point, name: '当前位置', created_at: Date.now() }).then(({ city }) => {
    if (version === locationVersion) locationCity.value = cityOption(city)?.name || ''
  }, () => {})
  // #endif
}, { immediate: true })
const aiLabels = shallowRef<Record<string, SpotLabels>>({})
const catalogLeads = shallowRef<SpotLead[]>([])
const catalogLoading = ref(false)
function recommendable(spot: Spot) {
  return spot.audience === 'public' && (!spot.status || spot.status === 'published') &&
    spot.fishing_status !== 'prohibited' && spot.precision !== 'hidden' &&
    !mentionsFishingRestriction(spot.description || '')
}
watch([() => data.value.items, () => auth.context], ([items]) => {
  if (!submitted.value && !type.value) {
    const cities = new Set(items.filter(spot => spot.audience === 'public')
      .map(spot => cityOption(spot.city || '')?.name).filter(Boolean))
    listCity.value = cities.size === 1 ? [...cities][0] || '' : ''
  }
  const version = ++labelsVersion
  if (!auth.signedIn) {
    aiLabels.value = {}
    return
  }
  void classifyVisibleSpots(items.filter(spot => recommendable(spot) && spot.description))
    .then(labels => {
      if (version === labelsVersion) aiLabels.value = labels
    })
})
const recommendCity = computed(() =>
  origin.value ? cityOption(submitted.value)?.name || locationCity.value || currentCity.value || listCity.value : ''
)
async function refreshLeads(reset = false) {
  const city = recommendCity.value
  const version = ++leadsVersion
  if (reset) catalogLeads.value = []
  catalogLoading.value = Boolean(city)
  if (!catalogLoading.value) return
  const leads = await loadPublicSpotLeads(city)
  if (version !== leadsVersion) return
  catalogLeads.value = leads ?? catalogLeads.value
  catalogLoading.value = false
}
watch([recommendCity, () => auth.context], () => void refreshLeads(true), { immediate: true })
const normalizedName = (value: string) => value.replace(/[\s·（）()]/g, '')
const leadKey = (lead: SpotLead) => lead.source.url + '#' + lead.name
const cityLeads = computed(() => !recommendCity.value ? [] :
  catalogLeads.value.filter(lead => lead.city === recommendCity.value))
const leadPlaces = shallowRef(new Map<string, MapPlace | null>())
watch(cityLeads, (leads) => {
  const version = ++placesVersion
  const keys = new Set(leads.map(leadKey))
  const existing = new Map([...leadPlaces.value].filter(([key]) => keys.has(key)))
  leadPlaces.value = existing
  const queue = leads.filter(lead => !existing.has(leadKey(lead)))
  async function locateNext() {
    while (queue.length && version === placesVersion) {
      const lead = queue.shift()!
      const place = await loadSpotLeadPlace(lead)
      if (version === placesVersion) leadPlaces.value = new Map(leadPlaces.value).set(leadKey(lead), place || null)
    }
  }
  for (let i = 0, parallel = Math.min(3, queue.length); i < parallel; i++) void locateNext()
}, { immediate: true })
const readingSpots = computed(() => loading.value || catalogLoading.value ||
  cityLeads.value.some(lead => !leadPlaces.value.has(leadKey(lead))))

const candidateCards = computed(() => {
  const point = origin.value
  if (!canSearch.value) return []
  const from = point ? [point.longitude, point.latitude] as const : undefined
  const coarse = entryPosition.value?.coarse
  const rows: {
    spot: InstanceType<typeof SpotCard>['$props']['spot']
    labels?: SpotLabels
    score: number
    lead?: LeadSource
    relatedSources?: LeadSource[]
    leadEvidence?: string
    leadVerifiedAt?: string
    catchFrame?: SpotLead['catchFrame']
    locationScope?: SpotLead['locationScope']
    place?: MapPlace
    sourceAddress?: string
    target: string
  }[] = []
  for (const record of data.value.items) {
    const point = fishingMapPoint(record.longitude, record.latitude)
    const distance = from && point ? distanceMeters(from, point) : undefined
    if (from && distance === undefined) continue
    const spot = {
      ...record,
      distance_m: distance,
      distance_approximate: coarse || record.distance_approximate ||
        (record.precision === 'area' && record.author.id !== auth.userId)
    }
    if (!recommendable(spot)) {
      rows.push({ spot, score: 0, target: spotCommunityKey(spot.id) })
      continue
    }
    const description = spot.description || ''
    const labels = { ...evidenceSpotLabels(description), ...verifiedSpotLabels(description, aiLabels.value[spot.id]) }
    const nearby = recommendCity.value && cityOption(spot.city || '')?.name === recommendCity.value
    rows.push({ spot, labels, score: 1 + (nearby ? 4 : 0) + Object.keys(labels).length, target: spotCommunityKey(spot.id) })
  }
  if (!from) return rows
  for (const lead of cityLeads.value) {
    if ((type.value && lead.waterType !== type.value) ||
        (query.value && ![lead.name, lead.displayName, lead.poiQuery, lead.city, lead.district, lead.sourceAddress]
          .some(value => value?.includes(query.value.trim())))) continue
    const name = normalizedName(lead.displayName || lead.name)
    const key = leadKey(lead)
    const place = leadPlaces.value.get(key)
    if (!place) continue
    const point = fishingMapPoint(place.longitude, place.latitude)
    if (!point) continue
    const distance = distanceMeters(from, point)
    if (distance === undefined) continue
    const duplicate = rows.find(row => cityOption(row.spot.city)?.name === lead.city &&
        (row.place?.id === place.id || normalizedName(row.spot.name) === name ||
          (name.length >= 5 && normalizedName(row.spot.name).includes(name))))
    if (duplicate) {
      if (duplicate.lead) duplicate.relatedSources = [
        ...duplicate.relatedSources || [], lead.source, ...lead.relatedSources || []
      ]
      continue
    }
    rows.push({
      spot: {
        id: key, city: lead.city, name: lead.displayName || lead.name,
        water_type: lead.waterType, observed_on: lead.sourceDate,
        distance_m: distance, distance_approximate: true
      },
      labels: lead.labels, lead: lead.source, target: leadCommunityKey(lead),
      relatedSources: lead.relatedSources, leadEvidence: lead.evidence, leadVerifiedAt: lead.verifiedAt,
      catchFrame: lead.catchFrame, locationScope: lead.locationScope,
      place,
      sourceAddress: lead.sourceAddress,
      score: 6 + Object.keys(lead.labels).length
    })
  }
  return rows
})
const {
  summaries, busy: communityBusy, commentsOpen, commentTarget,
  apply: updateCommunity, react, openComments, refresh: refreshCommunity
} = useSpotCommunity(computed(() => candidateCards.value.map(card => card.target)))
const cards = computed(() => {
  const rows = candidateCards.value.flatMap(card => {
    const community = summaries.value[card.target]
    if (community?.status === 'unavailable') return []
    const fishing_status = community?.status === 'prohibited' ? 'prohibited' as const
      : community?.status === 'open' ? 'allowed' as const : card.spot.fishing_status
    return [{ ...card, community, spot: { ...card.spot, fishing_status } }]
  })
  const likes = (row: typeof rows[number]) => row.spot.fishing_status === 'prohibited' ? 0
    : row.community?.rank_likes ?? row.community?.likes ?? 0
  const distance = (row: typeof rows[number]) => row.spot.distance_m ?? Number.MAX_VALUE
  rows.sort((left, right) => likes(right) - likes(left) ||
    distance(left) - distance(right) || right.score - left.score)
  return rows.map((row, index) => ({ ...row, rank: index < 3 && likes(row) ? index + 1 : undefined }))
})
watch([() => cards.value.length, () => data.value.next, loading, more.busy], ([count, next]) => {
  if (!count && next && !more.error.value) void loadMore()
})
watch(type, () => void load(), { immediate: true })
watch(
  query,
  invalidate,
  { flush: 'sync' }
)
function search(value: string) {
  submitted.value = value
  void load()
}
defineExpose({ refresh, reachBottom })
</script>
<template>
  <view class="stack">
    <MobileEmptyState v-if="!canSearch" icon="location" :title="locationTitle" :description="locationDescription">
      <view class="spots-location-actions">
        <MobileAction :class="outsideCoverage ? 'primary' : 'secondary'"
          @click="uni.navigateTo({ url: '/pages/map/search' })">按地名搜索</MobileAction>
        <MobileAction :class="outsideCoverage ? 'secondary' : 'primary'" :disabled="locating"
          @click="relocate">重新定位</MobileAction>
      </view>
    </MobileEmptyState>
    <template v-else>
      <MobileSearch
        :key="auth.context"
        v-model="query"
        name="spot-search"
        label="搜索钓位"
        placeholder="搜水域、城市或鱼种"
        action-label=""
        live
        @search="search"
      />
      <MobileSegmented
        v-model="type"
        label="水域类型"
        :options="[
          { value: '', label: '全部' },
          { value: '自然水域', label: '自然水域' },
          { value: '水库', label: '水库' },
          { value: '钓场', label: '钓场' }
        ]"
      />
      <MobileLoadError v-if="error" title="钓位暂未加载" :message="error" @retry="refresh" />
      <MobileSkeleton v-if="readingSpots && !cards.length" label="正在读取钓位…" />
      <SpotCard v-for="card in cards" :key="card.spot.id" :spot="card.spot"
        :labels="card.labels" :lead="card.lead" :place="card.place" :source-address="card.sourceAddress"
        :related-sources="card.relatedSources" :lead-evidence="card.leadEvidence" :lead-verified-at="card.leadVerifiedAt"
        :catch-frame="card.catchFrame" :location-scope="card.locationScope"
        :interactive="Boolean(card.lead) || ('audience' in card.spot && card.spot.audience === 'public' && card.spot.status === 'published')"
        :community="card.community" :rank="card.rank" :busy="communityBusy.has(card.target)"
        @react="kind => react(card.target, kind)" @comments="openComments(card.target, card.spot.name)" />
      <MobileListFooter
        :loading="more.busy.value || (readingSpots && !!cards.length && !more.error.value)"
        :error="more.error.value"
        :can-load-more="!!data.next && !loading && !error && query.trim() === submitted.trim()"
        :finished="!readingSpots && !data.next && !error"
        :count="cards.length"
        loading-label="正在加载更多钓位…"
        error-title="更多钓位暂未加载"
        @more="loadMore"
      />
      <SpotCommentsSheet v-model="commentsOpen" :target="commentTarget.id" :title="commentTarget.title"
        @summary="updateCommunity" />
      <FishingEmptyState
        v-if="!readingSpots && !more.busy.value && !error && !cards.length && !data.next"
        icon="location"
        :title="hasFilters ? '没有匹配的钓位' : '附近暂无钓位'"
        :description="hasFilters ? '试试其他关键词，或切换水域类型。' : undefined"
      />
    </template>
  </view>
</template>
<style scoped>
.spots-location-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: var(--fishing-gap-small);
  width: min(100%, 20rem);
}
</style>
