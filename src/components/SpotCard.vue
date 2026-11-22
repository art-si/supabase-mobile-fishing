<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { computed, ref } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import type { Spot } from '@/domain/models'
import type { MapPlace } from '@/domain/map'
import { distanceLabel } from '@/domain/place-distance'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import FishingPlaceLink from './FishingPlaceLink.vue'
import SpotStatusStamp from './SpotStatusStamp.vue'
import SpotReactionBar from './SpotReactionBar.vue'
import SpotSourceActions from './SpotSourceActions.vue'
import type { SpotCommunitySummary, SpotReaction } from '@/services/spot-community'
import { governmentNoticeUrl, leadSourceName, mediaSource, parseShareSource, preferences, preferenceKeys, shareSources,
  type LeadSource, type SpotLabels } from '../../supabase/functions/_shared/discovery-contract'
type CardSpot = Pick<Spot, 'id' | 'city' | 'name' | 'water_type' | 'observed_on'> &
  Partial<Pick<Spot, 'description' | 'status' | 'distance_m' | 'distance_approximate' | 'fishing_status' | 'species' | 'fee_note'>>
const props = defineProps<{
  spot: CardSpot
  labels?: SpotLabels
  lead?: LeadSource
  relatedSources?: LeadSource[]
  leadEvidence?: string
  place?: MapPlace
  sourceAddress?: string
  community?: SpotCommunitySummary
  interactive?: boolean
  rank?: number
  busy?: boolean
}>()
defineEmits<{ react: [kind: SpotReaction]; comments: [] }>()
const medals = ['🥇', '🥈', '🥉'] as const
const medal = computed(() => props.rank ? medals[props.rank - 1] : undefined)
const tags = computed(() => preferenceKeys.filter(key => props.labels?.[key]))
const sharedPlatforms = computed(() => props.lead ? [] :
  [...new Set(shareSources(props.spot.description || '').map(leadSourceName))])
const distance = computed(() => props.spot.distance_m == null
  ? ''
  : distanceLabel(props.spot.distance_m, 'km'))
const placeHint = computed(() => {
  const place = props.place
  if (!place) return ''
  const source = place.source === 'share' ? '作者分享定位' : '高德地点'
  return `${source} ${place.name} · 经度 ${Number(place.longitude.toFixed(6))} · 纬度 ${Number(place.latitude.toFixed(6))}`
})
const sourcesOpen = ref(false)
const sources = computed(() => {
  if (!props.lead) return []
  const links = new Map<string, LeadSource>()
  for (const source of [props.lead, ...props.relatedSources || []]) {
    const verified = source.platform === 'public' && governmentNoticeUrl(source.url)
      ? source : parseShareSource(source.url) || mediaSource(source.url)
    if (verified) links.set(verified.url.replace(/\/$/, ''), verified)
  }
  return [...links.values()]
})
onHide(() => { sourcesOpen.value = false })
</script>
<template>
  <view
    :class="[
      'panel stack spot-card',
      { 'spot-card--prohibited': spot.fishing_status === 'prohibited' }
    ]"
  >
    <view class="stack spot-card__body">
      <view class="row row--between spot-card__header spot-card__muted-content"
        ><view class="spot-card__tags">
          <view v-if="medal || spot.water_type" class="spot-card__type">
            <text v-if="medal" class="spot-card__medal" role="img" aria-role="img"
              :aria-label="`第${rank}名`">{{ medal }}</text>
            <text v-if="spot.water_type" class="badge">{{ spot.water_type }}</text>
          </view>
          <text v-if="medal && (community?.rank_likes ?? community?.likes ?? 0) >= 3" class="badge badge--warm">推荐</text>
          <text v-for="tag in tags" :key="tag" class="badge spot-card__recommendation-tag">{{ preferences[tag] }}</text>
          <text v-for="platform in sharedPlatforms" :key="platform" class="badge">{{ platform }}</text>
        </view
        ><text v-if="distance" class="caption spot-card__distance"
          >{{ spot.distance_approximate ? '距你约 ' : '距你 ' }}{{ distance }}</text
        ></view
      >
      <text v-if="spot.status === 'hidden'" class="badge badge--warm spot-card__muted-content">暂不可见</text>
      <MobileAction v-if="lead && sources.length" class="post-title spot-card__muted-content"
        :aria-label="`查看钓位：${spot.name}`" @click="sourcesOpen = true">
        <text class="heading">{{ spot.name }}</text>
      </MobileAction>
      <text v-else-if="lead" class="heading spot-card__muted-content">{{ spot.name }}</text>
      <MobileAction v-else
        class="post-title spot-card__muted-content"
        :aria-label="`查看钓位：${spot.name}`"
        @click="uni.navigateTo({ url: `/pages/spot/detail?id=${spot.id}` })"
        ><text class="heading">{{ spot.name }}</text></MobileAction
      >
      <FishingPlaceLink v-if="place || sourceAddress"
        class="spot-card__muted-content"
        :label="sourceAddress || place?.address || place?.name || ''"
        :longitude="place?.longitude" :latitude="place?.latitude"
        :approximate="!place" :hint="placeHint || '按公开资料中的地址搜索。'"
      />
      <view
        v-if="
          spot.fishing_status === 'prohibited' ||
          spot.species ||
          (spot.fee_note && spot.fee_note !== '未核实')
        "
        class="row row--between row--wrap spot-card__footer"
      >
        <view
          v-if="spot.species || (spot.fee_note && spot.fee_note !== '未核实')"
          class="fish-facts"
        >
          <text v-if="spot.species" class="fish-facts__main">{{ spot.species }}</text>
          <text v-if="spot.fee_note && spot.fee_note !== '未核实'">{{ spot.fee_note }}</text>
        </view>
        <SpotStatusStamp
          v-if="spot.fishing_status === 'prohibited'"
          class="spot-card__stamp"
          prohibited
        />
      </view>
    </view>
    <SpotReactionBar v-if="interactive" class="spot-card__actions" :community="community"
      :title="spot.name" :busy="busy" @react="kind => $emit('react', kind)" @comments="$emit('comments')" />
  </view>
  <MobileBottomSheet v-if="lead && sources.length" v-model="sourcesOpen" :title="spot.name"
    close-label="关闭钓位详情" root-portal>
    <view class="stack stack--tight spot-source-details">
      <text v-if="leadEvidence" class="body">{{ leadEvidence }}</text>
      <text v-if="spot.observed_on" class="caption muted">来源日期 · {{ spot.observed_on }}</text>
      <SpotSourceActions v-if="sourcesOpen" :sources="sources" />
    </view>
  </MobileBottomSheet>
</template>
<style scoped>
.spot-source-details {
  padding: 12px 16px 16px;
}
.spot-card {
  position: relative;
  gap: 8px;
}
.spot-card__body {
  position: relative;
  gap: 10px;
  min-width: 0;
}
.spot-card__stamp {
  margin-inline-start: auto;
  pointer-events: none;
}
.spot-card__header {
  --spot-tag-height: max(1.375rem, calc(var(--fishing-small-size) * 1.4 + 8px));
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.spot-card__tags {
  display: flex;
  flex: 1 1 min-content;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: min-content;
}
.spot-card__type {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-width: max-content;
}
.spot-card__tags .badge {
  white-space: nowrap;
}
.spot-card__medal {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-height: var(--spot-tag-height);
  font: 1.375rem/1 "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}
.spot-card__recommendation-tag {
  background: var(--inset);
  color: var(--ink);
  font-weight: 650;
}
.spot-card__actions {
  position: relative;
  z-index: 1;
}
.spot-card__footer {
  gap: 8px 16px;
}
.spot-card__distance {
  display: inline-flex;
  align-items: center;
  min-height: var(--spot-tag-height);
  flex-shrink: 0;
  margin-inline-start: auto;
  color: var(--lake);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.spot-card__footer > .fish-facts {
  flex: 1 1 auto;
  min-width: 0;
  gap: 4px 12px;
  padding: 0;
  border: 0;
  overflow-wrap: anywhere;
}
.spot-card--prohibited {
  --spot-muted-color: #151515;
  background: transparent;
}
.spot-card--prohibited::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ink);
  filter: grayscale(1);
  opacity: 0.038;
  pointer-events: none;
}
.spot-card--prohibited .spot-card__body {
  --ink: var(--spot-muted-color);
  --reed: var(--ink);
  --lake: var(--ink);
  z-index: 1;
  color: var(--ink);
}
.spot-card--prohibited .spot-card__footer {
  flex-wrap: nowrap;
}
.spot-card--prohibited .spot-card__muted-content,
.spot-card--prohibited .spot-card__footer > .fish-facts,
.spot-card--prohibited .spot-card__actions {
  filter: grayscale(1);
  opacity: 0.62;
}
.spot-card--prohibited .heading {
  font-weight: 550;
}
@media (prefers-color-scheme: dark) {
  .spot-card--prohibited {
    --spot-muted-color: #eeeeee;
  }
}
</style>
