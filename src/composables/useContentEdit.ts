import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import { isDemo } from '@/config'
import { read, write } from '@/services/repository'
import { resolvePhotos } from '@/services/media'
import { assertSession, sessionScope } from '@/services/session'
import { ApiError } from '@/services/http'
import { errorText } from '@/domain/rules'
import { useAuthStore } from '@/stores/auth'
import {
  editAttempt,
  editFields,
  type ContentType,
  type EditAttempt,
  type EditSnapshot
} from '@/domain/content-edit'
import type { ContentUpdateInfo, PostDraft, SpotDraft } from '@/domain/models'

/** Per-account, per-record edit drafts do not replace the independent new-record draft. */
export function useContentEdit<D extends PostDraft | SpotDraft>(options: {
  type: () => ContentType
  owner: Ref<string>
  draft: Ref<D>
  hydrate: (snapshot: EditSnapshot) => void
  latest?: boolean
}) {
  const auth = useAuthStore()
  const id = ref(''),
    revision = ref(0),
    loading = ref(false),
    ready = ref(false)
  const error = ref(''),
    conflict = ref(false),
    restored = ref(false),
    saving = ref(false)
  const editing = computed(() => Boolean(id.value))
  const baseline = ref('')
  const baselineWithoutStatus = ref('')
  function signature(ignoreStatus = false) {
    const fields = editFields(options.type(), options.draft.value)
    if (options.type() === 'spot') {
      fields.fishing_status ||= 'allowed'
      fields.location_label ||= ''
      if (ignoreStatus) delete fields.fishing_status
    }
    return JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)))
  }
  const dirty = computed(() => ready.value && signature() !== baseline.value)
  const onlyFishingStatusChanged = computed(
    () =>
      options.type() === 'spot' && dirty.value && signature(true) === baselineWithoutStatus.value
  )
  const publication = ref<EditSnapshot['publication']>(),
    contentUpdate = ref<ContentUpdateInfo | null>(null)
  let generation = 0,
    saved = false,
    pending: EditAttempt | undefined
  const key = () =>
    `dyj.${isDemo ? 'demo' : 'live'}.draft.${options.owner.value}.edit.${options.type()}.${id.value}`
  function persist() {
    if (
      !ready.value ||
      options.latest ||
      loading.value ||
      saved ||
      !options.owner.value ||
      auth.userId !== options.owner.value
    )
      return
    try {
      uni.setStorageSync(key(), { draft: options.draft.value, revision: revision.value, pending })
    } catch {
      error.value = '设备存储不足，修改暂时无法自动保存。请勿关闭页面。'
    }
  }
  watch(
    options.draft,
    () => {
      if (editing.value) persist()
    },
    { deep: true }
  )
  watch(conflict, async (value) => {
    if (!value) return
    await nextTick()
    uni.pageScrollTo({ scrollTop: 0, duration: 0 })
  })
  async function load(discard = false) {
    const current = ++generation,
      scope = sessionScope.value
    ready.value = false
    loading.value = false
    error.value = ''
    conflict.value = false
    restored.value = false
    publication.value = undefined
    contentUpdate.value = null
    pending = undefined
    saved = false
    if (!id.value || !options.owner.value) return
    loading.value = true
    try {
      const snapshot = await read<EditSnapshot>('edit_content', {
        type: options.type(),
        id: id.value
      })
      assertSession(scope)
      if (current !== generation) return
      let cached: { draft: D; revision: number; pending?: EditAttempt } | undefined
      try {
        if (!discard && !options.latest) cached = uni.getStorageSync(key()) || undefined
      } catch {
        /* fresh server copy */
      }
      const validCache =
        cached?.draft?.id === id.value &&
        Number.isSafeInteger(cached.revision) &&
        cached.revision > 0
      if (validCache && 'media' in cached!.draft && Array.isArray(cached!.draft.media)) {
        // Signed URLs are short-lived; refresh restored draft photos under the current owner.
        await resolvePhotos([cached!.draft as PostDraft])
        assertSession(scope)
        if (current !== generation) return
      }
      options.hydrate(snapshot)
      baseline.value = signature()
      baselineWithoutStatus.value = signature(true)
      publication.value = snapshot.publication
      contentUpdate.value =
        'content_update' in snapshot.item ? snapshot.item.content_update || null : null
      revision.value = validCache ? cached!.revision : snapshot.revision
      if (validCache) {
        options.draft.value = cached!.draft
        pending = cached!.pending
        restored.value = true
        conflict.value = cached!.revision !== snapshot.revision
      }
      await nextTick()
      assertSession(scope)
      if (current !== generation) return
      ready.value = true
      if (discard || options.latest) uni.removeStorageSync(key())
    } catch (e) {
      if (current === generation && scope === sessionScope.value) error.value = errorText(e)
    } finally {
      if (current === generation) loading.value = false
    }
  }
  function reset() {
    generation++
    ready.value = false
    loading.value = false
    saving.value = false
    error.value = ''
    pending = undefined
    publication.value = undefined
    contentUpdate.value = null
    saved = false
    baseline.value = ''
  }
  async function save() {
    if (!editing.value || !ready.value || conflict.value || saving.value)
      throw new Error('请先重新读取这条记录')
    const scope = sessionScope.value
    const command = editAttempt(options.type(), options.draft.value, revision.value, pending)
    pending = command.attempt
    persist()
    saving.value = true
    try {
      const result = await write<{ id: string; revision: number }>(
        'update_content',
        command.payload
      )
      assertSession(scope)
      saved = true
      try {
        uni.removeStorageSync(key())
      } catch {
        /* durable receipt makes a stale retry harmless */
      }
      return result
    } catch (e) {
      if (
        !options.latest &&
        scope === sessionScope.value &&
        e instanceof ApiError &&
        e.code === 'EDIT_CONFLICT'
      )
        conflict.value = true
      throw e
    } finally {
      if (scope === sessionScope.value) saving.value = false
    }
  }
  onUnmounted(() => {
    generation++
  })
  return {
    id,
    editing,
    dirty,
    onlyFishingStatusChanged,
    revision,
    publication,
    contentUpdate,
    loading,
    ready,
    error,
    conflict,
    restored,
    load,
    save,
    reset
  }
}
