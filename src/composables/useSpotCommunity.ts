import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useLoginAction } from '@/composables/useLoginAction'
import { errorText } from '@/domain/rules'
import { ApiError } from '@/services/http'
import { analyseSpotComments, reactToSpot, spotCommunitySummary,
  type SpotCommunitySummary, type SpotReaction } from '@/services/spot-community'

export function useSpotCommunity(targets: Readonly<Ref<string[]>>) {
  const auth = useAuthStore()
  const summaries = shallowRef<Record<string, SpotCommunitySummary>>({})
  const busy = shallowRef(new Set<string>())
  const commentsOpen = ref(false)
  const commentTarget = ref({ id: '', title: '' })
  const changes = new Map<string, number>()
  let version = 0

  function apply(summary: SpotCommunitySummary) {
    changes.set(summary.target, (changes.get(summary.target) || 0) + 1)
    summaries.value = { ...summaries.value, [summary.target]: summary }
  }
  async function refresh() {
    const current = ++version
    const before = new Map(changes)
    const results = await spotCommunitySummary(targets.value).catch(() => null)
    if (current !== version || !results) return
    const next = { ...summaries.value }
    for (const result of results) {
      if (before.get(result.target) === changes.get(result.target)) next[result.target] = result
    }
    summaries.value = next
    if (auth.signedIn) {
      const scope = auth.context
      for (const result of results.filter(item => item.pending_analysis).slice(0, 2)) {
        void analyseSpotComments(result.target).then(analysed => {
          if (auth.context === scope) for (const updated of analysed) apply(updated)
        }).catch(() => { /* Later reads can retry queued comments. */ })
      }
    }
  }
  watch(targets, () => void refresh(), { immediate: true })
  watch(() => auth.context, () => {
    summaries.value = {}
    changes.clear()
    busy.value = new Set()
    void refresh()
  }, { flush: 'sync' })
  onScopeDispose(() => { version++ })

  type Intent = { target: string; kind: SpotReaction; enabled: boolean }
  async function send(intent: Intent) {
    if (busy.value.has(intent.target)) return
    const scope = auth.context
    busy.value = new Set(busy.value).add(intent.target)
    try {
      const result = await reactToSpot(intent.target, intent.kind, intent.enabled)
      if (auth.context === scope) apply(result)
    } catch (cause) {
      if (auth.context === scope) uni.showToast({
        title: cause instanceof ApiError && cause.code === 'PGRST202'
          ? '钓位互动暂不可用，请稍后重试' : errorText(cause), icon: 'none'
      })
    } finally {
      if (auth.context === scope) {
        const current = new Set(busy.value)
        current.delete(intent.target)
        busy.value = current
      }
    }
  }
  const login = useLoginAction<Intent>(send)
  function react(target: string, kind: SpotReaction) {
    const current = summaries.value[target]
    const enabled = kind === 'like' ? !current?.liked : !current?.saved
    const intent = { target, kind, enabled }
    if (login.requireLogin(intent)) void send(intent)
  }
  function openComments(id: string, title: string) {
    commentTarget.value = { id, title }
    commentsOpen.value = true
  }
  return { summaries, busy, commentsOpen, commentTarget, apply, refresh, react, openComments }
}
