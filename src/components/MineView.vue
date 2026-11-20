<script setup lang="ts">
defineOptions({ options: { styleIsolation: 'apply-shared' } })
import { watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import { activateActionKey, preventActionKey } from '@mobile-core/action-keyboard'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import FishMark from './FishMark.vue'
import FishingLoadingStatus from './FishingLoadingStatus.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import { useAuthStore } from '@/stores/auth'
import { useResource } from '@/composables/useResource'
import { read } from '@/services/repository'
import type { PersonDetail } from '@/domain/models'
const auth = useAuthStore()
const { data, error, loading, load } = useResource(
  () =>
    auth.signedIn ? read<PersonDetail>('profile', { id: auth.userId }) : Promise.resolve(null),
  null as PersonDetail | null
)
watch(
  () => auth.userId,
  () => void load(),
  { immediate: true }
)
const links = [
  {
    label: '我的收藏',
    subtitle: '把喜欢的心得和钓位留住',
    icon: 'flag',
    url: '/pages/mine/library?type=saved'
  },
  {
    label: '我的记录',
    subtitle: '渔获与心得，都是经验',
    icon: 'photo',
    url: '/pages/mine/library?type=posts'
  },
  {
    label: '我的钓位',
    subtitle: '私人位置，由你决定分享范围',
    icon: 'location',
    url: '/pages/mine/library?type=spots'
  },
  {
    label: '我的钓友',
    subtitle: '认识更多同路人',
    icon: 'user',
    url: '/pages/people/index?tab=friends'
  },
  {
    label: '水域线索上报',
    subtitle: '私密整理线索，查找官方渠道',
    icon: 'shield',
    url: '/pages/water-report/index'
  },
  {
    label: '我的社区举报',
    subtitle: '查看社区内容与钓位纠错进度',
    icon: 'flag',
    url: '/pages/content-report/index'
  }
]
function open(url: string) {
  if (auth.requireLogin()) uni.navigateTo({ url })
}
defineExpose({ refresh: load })
</script>
<template>
  <view class="stack">
    <MobileLoadError v-if="error" :message="error" @retry="load" />
    <FishingLoadingStatus v-if="loading && auth.signedIn && !data" label="正在读取你的出钓资料…" />
    <button
      class="mobile-action panel mine-profile"
      role="button"
      :tabindex="0"
      hover-class="mobile-action--pressed"
      :aria-label="auth.signedIn ? '编辑钓友资料' : '手机号登录 / 注册'"
      @click="open('/pages/mine/profile')"
      @keydown="preventActionKey"
      @keyup="activateActionKey($event, () => open('/pages/mine/profile'))"
    >
      <view class="mine-profile__identity">
        <MobileAvatar :src="data?.profile.avatar?.url" :name="data?.profile.nickname" :size="56">
          <FishMark v-if="!data?.profile.nickname" :size="36" />
          <text v-else>{{ data.profile.nickname.slice(0, 1) }}</text>
        </MobileAvatar>
        <view class="mine-profile__copy">
          <text class="heading mine-profile__name">{{
            data?.profile.nickname || (auth.signedIn ? '钓友' : '登录钓友集')
          }}</text>
          <text v-if="data?.profile.bio || !auth.signedIn" class="muted mine-profile__bio">{{
            data?.profile.bio || '同步收藏、钓位与出钓记录'
          }}</text>
        </view>
        <view class="mine-profile__edit">
          <text>{{ auth.signedIn ? '编辑钓友资料' : '手机号登录 / 注册' }}</text>
          <MobileIcon name="chevron" :size="16" />
        </view>
      </view>
    </button>
    <MobileAction class="primary" @click="uni.navigateTo({ url: '/pages/post/compose' })"
      ><MobileIcon name="add" :size="20" />记录鱼情</MobileAction
    >
    <view class="panel"
      ><MobileAction v-for="link in links" :key="link.url" class="list-row" @click="open(link.url)"
        ><MobileIcon :name="link.icon" :size="22" /><view class="grow stack stack--tight"
          ><text class="name">{{ link.label }}</text>
          <text v-if="link.url.includes('report')" class="caption">{{ link.subtitle }}</text></view
        ><MobileIcon name="chevron" :size="16" /></MobileAction
    ></view>
    <MobileAction class="panel list-row" @click="uni.navigateTo({ url: '/pages/settings/index' })"
      ><MobileIcon name="settings" :size="22" /><text class="grow name">设置与隐私</text
      ><MobileIcon name="chevron" :size="16"
    /></MobileAction>
  </view>
</template>
<style scoped>
.mine-profile.mobile-action {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  padding: 24px;
  color: var(--ink);
  text-align: left;
  white-space: normal;
}
.mine-profile__identity {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  width: 100%;
}
.mine-profile__copy {
  display: flex;
  flex: 1 1 5.5rem;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.mine-profile__name {
  font-size: 1.375rem;
  overflow-wrap: anywhere;
}
.mine-profile__bio {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mine-profile__edit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-height: 48px;
  max-width: 100%;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--lake);
}
.mine-profile__edit .mobile-icon {
  flex: none;
}
@media (max-width: 359px) {
  .mine-profile.mobile-action {
    padding: 20px;
  }
  .mine-profile__identity {
    gap: 12px;
  }
}
</style>
