<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import FishFacts from '@/components/FishFacts.vue'
import FishingPlaceLink from '@/components/FishingPlaceLink.vue'
import FishingPhotos from '@/components/FishingPhotos.vue'
import ContentReviewStatus from '@/components/ContentReviewStatus.vue'
import ContentOwnerActions from '@/components/ContentOwnerActions.vue'
import SpotStatusStamp from '@/components/SpotStatusStamp.vue'
import SpotDeleteAction from '@/components/SpotDeleteAction.vue'
import ContentReportAction from '@/components/ContentReportAction.vue'
import ShareToChat from '@/components/ShareToChat.vue'
// #ifdef MP-WEIXIN
import StaticMapPreview from '@/components/StaticMapPreview.vue'
// #endif
import { read, write } from '@/services/repository'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useLoginAction } from '@/composables/useLoginAction'
import { useAuthStore } from '@/stores/auth'
import { audienceLabels, canNavigate, validCoordinates } from '@/domain/rules'
import { describeSpotLocation } from '@/platforms/spot-location'
import type { Spot } from '@/domain/models'
const id = ref(''),
  auth = useAuthStore(),
  mutation = useMutation()
const { data, error, loading, load, invalidate } = useResource(
  () => read<Spot>('spot', { id: id.value }),
  null as Spot | null
)
const resolvedAddress = ref('')
let addressVersion = 0
const placeLabel = computed(() => {
  const spot = data.value
  if (!spot) return ''
  if (spot.precision !== 'exact') return spot.city ? `${spot.city}附近` : '大致水域'
  return spot.location_label?.trim() || resolvedAddress.value || `${spot.city} · ${spot.name}`
})
watch(
  () => [
    data.value?.id,
    data.value?.location_label,
    data.value?.precision,
    data.value?.longitude,
    data.value?.latitude,
    auth.context
  ],
  async () => {
    const version = ++addressVersion,
      spot = data.value
    resolvedAddress.value = ''
    if (!spot || spot.location_label || !canNavigate(spot)) return
    try {
      const place = await describeSpotLocation({
        longitude: spot.longitude!,
        latitude: spot.latitude!,
        name: '已选位置',
        crs: 'GCJ-02',
        created_at: Date.now()
      })
      if (version === addressVersion) resolvedAddress.value = place.label
    } catch {
      /* Older records can still navigate using their shared exact point. */
    }
  }
)
onLoad((options) => {
  id.value = options?.id || ''
  void load()
})
onShow(() => {
  if (id.value) void load()
})
type Bookmark = { id: string; enabled: boolean }
const loginAction = useLoginAction<Bookmark>((intent) => applyBookmark(intent, true))
async function bookmark() {
  if (!data.value || mutation.busy.value) return
  const intent = { id: id.value, enabled: auth.signedIn ? !data.value.saved : true }
  if (!loginAction.requireLogin(intent)) return
  await applyBookmark(intent)
}
async function applyBookmark(intent: Bookmark, resumed = false) {
  if (id.value !== intent.id) return
  await mutation.run(async () => {
    const scope = auth.context
    invalidate()
    try {
      await write('spot_bookmark', intent)
    } finally {
      if (auth.context === scope) await load()
    }
    if (resumed && auth.context === scope) uni.showToast({ title: '已收藏', icon: 'none' })
  })
}
</script>
<template>
  <FishingShell title="钓位详情" back
    ><view class="fishing-content stack"
      ><MobileLoadError v-if="error" :message="error" @retry="load" />
      <FishingLoadingStatus v-if="loading && !data" label="正在读取这个钓位…" />
      <template v-if="data && !error"
        ><ContentReviewStatus
          v-if="data.status === 'hidden'"
          :id="data.id"
          type="spot"
          :status="data.status"
          :owner="data.author.id"
        /><view class="panel stack spot-summary"
          ><view class="row row--between"
            ><text class="badge">{{ data.water_type }}</text
            ><text class="caption">{{ data.city }}</text></view
          ><text class="heading spot-summary__title">{{ data.name }}</text
          ><text v-if="data.description" class="body">{{ data.description }}</text
          ><FishingPhotos
            v-if="data.media?.length"
            :media="data.media"
            label="钓位现场照片"
            full
          /><view
            v-if="data.species || data.fishing_status === 'prohibited'"
            :class="[
              'row row--between row--wrap spot-summary__facts',
              { 'spot-summary__facts--prohibited': data.fishing_status === 'prohibited' }
            ]"
            ><FishFacts v-if="data.species" :species="data.species" /><SpotStatusStamp
              v-if="data.fishing_status === 'prohibited'"
              class="spot-summary__stamp"
              prohibited
          /></view>
          <view v-if="data.precision !== 'hidden'" class="spot-summary__place">
            <FishingPlaceLink
              :label="placeLabel"
              :longitude="data.longitude"
              :latitude="data.latitude"
              :approximate="data.precision !== 'exact'"
              :navigation="canNavigate(data)"
            />
          </view>
          <MobileAction
            class="spot-summary__author"
            :aria-label="`查看${data.author.nickname}的主页`"
            @click="uni.navigateTo({ url: `/pages/people/detail?id=${data.author.id}` })"
          >
            <MobileAvatar :src="data.author.avatar?.url" :name="data.author.nickname" :size="36" />
            <view class="spot-summary__author-copy"
              ><text class="name">{{ data.author.nickname }}</text
              ><text v-if="data.audience !== 'public'" class="caption">{{
                audienceLabels[data.audience]
              }}</text></view
            >
          </MobileAction>
        </view>
        <view
          v-if="data.access_note || (data.fee_note && data.fee_note !== '未核实')"
          class="panel stack"
        >
          <text v-if="data.fee_note && data.fee_note !== '未核实'" class="body"
            >费用：{{ data.fee_note }}</text
          >
          <text v-if="data.access_note" class="body">到达说明：{{ data.access_note }}</text>
        </view>
        <!-- #ifdef MP-WEIXIN -->
        <view
          v-if="data.precision !== 'hidden' && validCoordinates(data.longitude, data.latitude)"
          class="panel"
        >
          <StaticMapPreview :target="{ spotId: data.id }" :area="data.precision === 'area'" />
        </view>
        <!-- #endif -->
        <view class="panel stack stack--tight spot-tools">
          <view class="spot-tools__primary">
            <MobileAction
              class="text-action spot-tool-action"
              :disabled="mutation.busy.value"
              :aria-pressed="data.saved"
              @click="bookmark"
              ><MobileIcon name="flag" :size="18" />{{
                data.saved ? '已收藏' : '收藏'
              }}</MobileAction
            >
            <ShareToChat
              v-if="data.status === 'published' && data.audience !== 'private'"
              :id="data.id"
              type="spot"
              :title="data.name"
              compact
            />
          </view>
          <ContentOwnerActions
            :id="data.id"
            type="spot"
            :owner="data.author.id"
            :audience="data.audience"
            :revision="data.review_revision"
            compact
            @changed="load"
          />
          <SpotDeleteAction :id="data.id" :owner="data.author.id" compact />
        </view>
        <ContentReportAction :id="data.id" type="spot" :owner="data.author.id" /> </template
      ><text v-if="mutation.error.value && !error" class="error" role="alert">{{
        mutation.error.value
      }}</text>
    </view></FishingShell
  >
</template>
<style scoped>
.spot-summary {
  gap: 16px;
}
.spot-summary__title {
  overflow-wrap: anywhere;
}
.spot-summary__facts {
  position: relative;
  gap: 12px;
}
.spot-summary__facts--prohibited {
  min-height: 3.25rem;
  padding-right: 4.25rem;
}
.spot-summary__stamp {
  position: absolute;
  right: 0;
  top: 0;
}
.spot-tools {
  gap: 8px;
  padding-block: 8px;
}
.spot-tools__primary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 6rem), 1fr));
  gap: 8px;
}
.spot-tools :deep(.mobile-action) {
  min-height: 48px;
}
.spot-tools :deep(.content-owner-actions--compact) {
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.spot-tools :deep(.mobile-action-group) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 6rem), 1fr));
  gap: 8px;
}
.spot-summary__facts > :first-child:not(:last-child) {
  margin-right: auto;
}
.spot-summary__place {
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--inset);
}
.spot-summary__author.mobile-action {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  width: 100%;
  padding: 4px 0;
  text-align: left;
}
.spot-summary__author-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
