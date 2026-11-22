<script setup lang="ts">
import { ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import { useListEnd } from '@/composables/useListEnd'
import DiscussionAvatar from './DiscussionAvatar.vue'
import type { DiscussionPerson } from '@/domain/models'
import { read } from '@/services/repository'
import { useAuthStore } from '@/stores/auth'
defineOptions({ options: { styleIsolation: 'apply-shared' } })
const props = defineProps<{ target: string; count: number }>()
const auth = useAuthStore()
const people = ref<DiscussionPerson[]>([]), next = ref<string | null>(null)
const loading = ref(false), failed = ref(false)
const expanded = ref(false)
let version = 0
function openProfile(id: string) {
  expanded.value = false
  uni.navigateTo({ url: '/pages/people/detail?id=' + encodeURIComponent(id) })
}
async function load(append = false) {
  if (!props.target || !props.count || loading.value || (append && !next.value)) return
  const current = version
  loading.value = true
  failed.value = false
  try {
    const page = await read<{ items: DiscussionPerson[]; next: string | null }>('discussion_likes',
      { target: props.target, cursor: append ? next.value : null })
    if (current !== version) return
    const previous = new Set(people.value.map(person => person.id))
    people.value = append ? [...people.value, ...page.items.filter(person => !previous.has(person.id))] : page.items
    next.value = page.next
  } catch {
    if (current === version) failed.value = true
  } finally { if (current === version) loading.value = false }
}
watch([() => props.target, () => props.count, () => auth.context], (_, __, cleanup) => {
  expanded.value = false
  people.value = []; next.value = null; loading.value = failed.value = false
  cleanup(() => { version++ })
  void load()
}, { immediate: true })
const end = useListEnd('.discussion-likes__end', () => expanded.value && !!next.value && !loading.value && !failed.value,
  () => void load(true))
</script>
<template>
  <view v-if="people.length || failed" class="discussion-likes" aria-label="赞过的钓友">
    <view class="discussion-likes__heart" aria-hidden="true"><wd-icon name="heart" size="20px" /></view>
    <view class="discussion-likes__people">
      <MobileAction v-for="person in people.slice(0, 18)" :key="person.id" class="discussion-likes__person"
        :aria-label="`查看${person.nickname}的主页`" @click="openProfile(person.id)">
        <DiscussionAvatar :person="person" :size="36" />
      </MobileAction>
      <MobileAction v-if="!people.length && failed" class="text-action discussion-likes__more" :disabled="loading" @click="load()">重试</MobileAction>
      <MobileAction v-else-if="next || people.length > 18" class="text-action discussion-likes__more" @click="expanded = true">更多点赞</MobileAction>
    </view>
  </view>
  <MobileBottomSheet v-if="expanded" v-model="expanded" title="赞过的钓友" close-label="关闭点赞名单" tall root-portal :z-index="180">
    <view class="discussion-likes__list">
      <MobileAction v-for="person in people" :key="person.id" class="discussion-likes__row"
        :aria-label="`查看${person.nickname}的主页`" @click="openProfile(person.id)">
        <DiscussionAvatar :person="person" /><text>{{ person.nickname }}</text>
      </MobileAction>
      <!-- #ifdef H5 -->
      <span v-if="next" ref="end" class="discussion-likes__end" aria-hidden="true" />
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <view v-if="next" class="discussion-likes__end" aria-hidden="true" />
      <!-- #endif -->
      <MobileListFooter :loading="loading" :can-load-more="!!next" :error="failed ? '点赞名单未能更新' : ''"
        :finished="!next && !failed" :count="people.length" @more="load(true)" />
    </view>
  </MobileBottomSheet>
</template>
<style scoped>
.discussion-likes { display: grid; grid-template-columns: 36px minmax(0,1fr); align-items: start; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); color: var(--discussion-name); }
.discussion-likes__heart, .discussion-likes__person.mobile-action, .discussion-likes__more.mobile-action {
  display: flex; align-items: center; justify-content: center; height: 44px; min-height: 44px; padding: 0; line-height: 1;
}
.discussion-likes__heart { width: 36px; }
.discussion-likes__people { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; margin-inline-start: -4px; }
.discussion-likes__person.mobile-action { width: 44px; min-width: 44px; background: transparent; }
.discussion-likes__person :deep(.discussion-avatar) { align-self: center; }
.discussion-likes__more.mobile-action { min-width: 44px; padding-inline: 4px; color: var(--discussion-name); }
.discussion-likes__list { padding: 8px 16px 16px; }
.discussion-likes__row.mobile-action { display: flex; justify-content: start; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 6px 0; color: var(--discussion-name); text-align: start; overflow-wrap: anywhere; }
.discussion-likes__end { display: block; height: 1px; }
</style>
