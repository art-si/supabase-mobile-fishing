<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import FishingShell from '@/components/FishingShell.vue'
import FishingLoadingStatus from '@/components/FishingLoadingStatus.vue'
import MobileSearch from '@mobile-core/components/MobileSearch.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileAvatar from '@mobile-core/components/MobileAvatar.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileEmptyState from '@/components/FishingEmptyState.vue'
import { useResource } from '@/composables/useResource'
import { useMutation } from '@/composables/useMutation'
import { useAuthStore } from '@/stores/auth'
import { read, write } from '@/services/repository'
import { onSocialUpdate } from '@/services/live-updates'
import { appForeground } from '@/services/app-activity'
import { usePageActivity } from '@mobile-core/page-activity'
import type { Profile, SocialSnapshot } from '@/domain/models'
const auth = useAuthStore(),
  tab = ref('discover'),
  query = ref(''),
  submitted = ref(''),
  mutation = useMutation()
const people = useResource(() => read<Profile[]>('people', { query: submitted.value }), [])
const social = useResource(
  () =>
    auth.signedIn
      ? read<SocialSnapshot>('social')
      : Promise.resolve({ friends: [], requests: [], conversations: [] }),
  { friends: [], requests: [], conversations: [] }
)
onLoad((options) => {
  if (['friends', 'requests'].includes(options?.tab || '')) tab.value = options!.tab!
})
let stopLive: (() => void) | undefined, poll: ReturnType<typeof setInterval> | undefined
function stopUpdates() {
  stopLive?.()
  stopLive = undefined
  clearInterval(poll)
  poll = undefined
  people.invalidate()
  social.invalidate()
}
usePageActivity(
  appForeground,
  () => {
    stopUpdates()
    stopLive = onSocialUpdate(() => void social.load())
    poll = setInterval(() => {
      if (auth.signedIn) void social.load()
    }, 10000)
    void people.load()
    void social.load()
  },
  stopUpdates
)
watch(
  query,
  () => {
    people.invalidate()
    people.data.value = []
  },
  { flush: 'sync' }
)
function search(value: string) {
  submitted.value = value
  void people.load()
}
watch(
  () => auth.context,
  () => {
    query.value = ''
    submitted.value = ''
  },
  { flush: 'sync' }
)
async function respond(id: string, accept: boolean) {
  await mutation.run(async () => {
    await write('friend_respond', { id, accept })
    await social.load()
  })
}
</script>
<template>
  <FishingShell title="认识钓友" back
    ><view class="fishing-content stack">
      <MobileSegmented
        v-model="tab"
        label="钓友列表"
        :options="[
          { value: 'discover', label: '发现钓友' },
          { value: 'friends', label: '我的好友' },
          { value: 'requests', label: '好友申请' }
        ]"
      />
      <FishingLoadingStatus
        v-if="tab === 'discover' ? people.loading.value : auth.signedIn && social.loading.value"
        label="正在寻找钓友…"
      />
      <template v-if="tab === 'discover'"
        ><MobileSearch
          :key="auth.context"
          v-model="query"
          name="people-search"
          label="搜索钓友"
          placeholder="昵称、钓友号或城市"
          action-label=""
          live
          @search="search" /><text class="caption"
          >不支持按手机号搜索，也不展示钓友的实时位置。</text
        ><MobileLoadError
          v-if="people.error.value"
          :message="people.error.value"
          @retry="people.load" /><view v-if="people.data.value.length" class="panel"
          ><MobileAction
            v-for="person in people.data.value"
            :key="person.id"
            class="list-row"
            @click="uni.navigateTo({ url: `/pages/people/detail?id=${person.id}` })"
            ><MobileAvatar :src="person.avatar?.url" :name="person.nickname" />
            <view class="grow stack stack--tight"
              ><text class="name">{{ person.nickname }}</text
              ><text class="caption"
                >{{ person.city || '未填写城市' }} · {{ person.method || '钓法不限' }}</text
              ></view
            ><text class="badge">看看主页</text></MobileAction
          ></view
        ><MobileEmptyState
          v-else-if="!people.loading.value && !people.error.value"
          icon="user"
          title="还没遇见这位钓友"
          description="换个昵称或城市试试。"
      /></template>
      <MobileEmptyState
        v-else-if="!auth.signedIn"
        icon="user"
        title="登录后添加好友"
        description="朋友之间，鱼情更有来有往。"
        ><MobileAction class="primary" @click="auth.requireLogin()"
          >手机号登录</MobileAction
        ></MobileEmptyState
      >
      <template v-else
        ><MobileLoadError
          v-if="social.error.value"
          :message="social.error.value"
          @retry="social.load"
        />
        <template v-if="tab === 'friends'"
          ><view v-if="social.data.value.friends.length" class="panel"
            ><MobileAction
              v-for="friend in social.data.value.friends"
              :key="friend.id"
              class="list-row"
              @click="uni.navigateTo({ url: `/pages/people/detail?id=${friend.id}` })"
              ><MobileAvatar :src="friend.avatar?.url" :name="friend.nickname" />
              <view class="stack stack--tight"
                ><text class="name">{{ friend.nickname }}</text
                ><text class="caption">{{ friend.city }} · {{ friend.method }}</text></view
              ></MobileAction
            ></view
          ><MobileEmptyState
            v-else-if="!social.loading.value && !social.error.value"
            icon="user"
            title="好友从一句问候开始"
            description="去发现钓友，看看谁和你有相同的爱好。"
        /></template>
        <template v-else
          ><view v-for="request in social.data.value.requests" :key="request.id" class="panel stack"
            ><text class="name">{{
              request.sender.id === auth.userId
                ? `已向 ${request.recipient.nickname} 发送申请`
                : request.sender.nickname
            }}</text
            ><text class="body">{{ request.note || '想与你交流钓鱼经验' }}</text
            ><view v-if="request.recipient.id === auth.userId" class="mobile-action-group"
              ><MobileAction
                class="primary grow"
                :disabled="mutation.busy.value"
                @click="respond(request.id, true)"
                >接受</MobileAction
              ><MobileAction
                class="secondary grow"
                :disabled="mutation.busy.value"
                @click="respond(request.id, false)"
                >暂不接受</MobileAction
              ></view
            ><text v-else class="caption">等待对方同意</text></view
          ><MobileEmptyState
            v-if="
              !social.data.value.requests.length && !social.loading.value && !social.error.value
            "
            icon="user"
            title="没有待处理的申请"
            description="关注是单向订阅，好友需要双方同意。"
        /></template> </template
      ><text v-if="mutation.error.value" class="error" role="alert">{{
        mutation.error.value
      }}</text>
    </view></FishingShell
  >
</template>
