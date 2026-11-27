<script setup lang="ts">
import { ref, watch } from 'vue'
import { onHide } from '@dcloudio/uni-app'
import { useLongPressAction } from '@mobile-core/long-press-action'
import { useAuthStore } from '@/stores/auth'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import ContentDeleteAction from './ContentDeleteAction.vue'
import FishingPhotos from './FishingPhotos.vue'
import FishFacts from './FishFacts.vue'
import TripCatchList from './TripCatchList.vue'
import { editRoute } from '@/domain/content-edit'
import type { Trip } from '@/domain/models'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ trip: Trip; owner: string; busy?: boolean }>()
const emit = defineEmits<{ use: [intent: 'repeat' | 'share'] }>()
const auth = useAuthStore(), card = ref<unknown>(), deletion = ref<InstanceType<typeof ContentDeleteAction>>()
const longPress = useLongPressAction(() => deletion.value?.open(), () => Boolean(props.owner) && props.owner === auth.userId && !props.busy, card)
watch(() => [props.trip.id, props.owner, auth.context], longPress.reset, { flush: 'sync' })
onHide(longPress.reset)
function edit() { if (longPress.allowClick()) uni.navigateTo({ url: editRoute('trip', props.trip.id) }) }
function use(intent: 'repeat' | 'share') { if (longPress.allowClick()) emit('use', intent) }
</script>
<template>
  <view ref="card" class="panel stack trip-card" @longpress="longPress.hold" @touchend="longPress.release" @touchcancel="longPress.release">
    <text class="caption">{{ trip.occurred_on }} · 私人日志</text>
    <text class="heading">{{ trip.title }}</text><text class="body">{{ trip.body }}</text>
    <FishingPhotos v-if="trip.media?.length" :media="trip.media" :label="`${trip.title}的照片`" />
    <FishFacts :method="trip.method" :bait="trip.bait" /><TripCatchList :trip="trip" />
    <view class="mobile-action-group">
      <MobileAction class="text-action" :disabled="busy" @click="edit">编辑日志</MobileAction>
      <MobileAction class="text-action" :disabled="busy" @click="use('repeat')">再记一次</MobileAction>
      <MobileAction class="text-action" :disabled="busy" @click="use('share')">生成分享草稿</MobileAction>
    </view>
    <ContentDeleteAction ref="deletion" :id="trip.id" type="trip" :owner="owner" :title="trip.title" :show-button="false" :disabled="busy" />
  </view>
</template>
