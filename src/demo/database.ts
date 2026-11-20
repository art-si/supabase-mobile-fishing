import { seed, type DemoData } from './seed'
import { createId, safeSpot, optionalNumber } from '@/domain/rules'
import { postCaption, compositionLimits } from '@/domain/composition'
import { ApiError } from '@/services/http'
import { serviceErrorMessage } from '@/domain/user-errors'
import { REPORT_CONSENT, localReportTime, validateWaterReport, type WaterReportDraft } from '@/domain/water-report'
import { catchRecordsFromDraft, catchSummary, freshCatch } from '@/domain/trip-catches'
import { catchNumber } from '@/domain/catch-measurements'
import { distanceMeters } from '@mobile-core/coordinates'
import type {
  Audience,
  CatchRecord,
  Comment,
  Media,
  Message,
  Payload,
  Post,
  PostDraft,
  Precision,
  Profile,
  Spot,
  SpotDraft
} from '@/domain/models'
const key = 'dyj.demo.database.v1'
function validateComposition(draft: PostDraft, type: 'post' | 'trip') {
  const code =
    type === 'trip' && !draft.title.trim()
      ? 'COMPOSITION_TITLE_REQUIRED'
      : type === 'post' && !draft.body.trim() && !draft.media?.length
        ? 'COMPOSITION_EMPTY'
        : draft.title.length > compositionLimits.title ||
            draft.body.length > compositionLimits.body ||
            (draft.media?.length || 0) > compositionLimits.photos
          ? 'INVALID_INPUT'
          : ''
  if (code) throw new ApiError(serviceErrorMessage(code)!, 400, code)
}
let db: DemoData | undefined
function database() {
  if (!db) {
    try {
      const stored = uni.getStorageSync(key)
      db = stored?.profiles ? stored : seed()
    } catch {
      db = seed()
    }
  }
  return db!
}
function pair(a: string, b: string) {
  return `${a}:${b}`
}
export function rememberDemoPhoto(owner: string, asset: Media) {
  const data = database()
  data.draftPhotos ??= []
  data.draftPhotos.push({ owner, asset })
  uni.setStorageSync(key, data)
}
export function execute(
  kind: 'read' | 'write',
  action: string,
  input: Payload,
  user: string
): unknown {
  const d = database()
  d.authorReceipts ??= {}
  d.contentUpdates ??= {}
  d.waterReports ??= []
  d.waterReportReceipts ??= {}
  d.deletedWaterReportOwners ??= {}
  d.draftPhotos ??= []
  d.deletedWaterReports ??= []
  d.deletedTrips ??= []
  const id = String(input.id || '')
  const updateKey = `${input.type}:${id}`
  const spotPhotos = (photos: Media[], current: Media[] = [], proposed: Media[] = []) => {
    if (
      !Array.isArray(photos) ||
      photos.length > 9 ||
      new Set(photos.map((p) => p.id)).size !== photos.length
    )
      throw new Error('照片不可用，请重新选择')
    return photos.map((photo) => {
      const asset =
        current.find((p) => p.id === photo.id) ||
        proposed.find((p) => p.id === photo.id) ||
        d.draftPhotos?.find((p) => p.owner === user && p.asset.id === photo.id)?.asset
      const elsewhere = [
        ...d.posts,
        ...d.trips,
        ...d.spots.filter((s) => s.id !== id),
        ...d.messages
      ].some((item) => item.media?.some((p) => p.id === photo.id))
      if (!asset || asset.kind === 'video' || elsewhere) throw new Error('照片不可用，请重新选择')
      return asset
    })
  }
  const updateInfo = (type: 'post' | 'spot', target: string, owner: string) => {
    const update = d.contentUpdates[`${type}:${target}`]
    return owner === user && update?.owner === user
      ? { status: update.status, reason: update.reason, submitted_at: update.submitted_at }
      : null
  }
  const decorateSpot = (s: Spot) => ({
    ...safeSpot(s, s.author.id === user),
    content_update: updateInfo('spot', s.id, s.author.id)
  })
  const profile = (uid: string) => d.profiles.find((p) => p.id === uid)!
  const blocked = (a: string, b: string) =>
    d.blocks.includes(pair(a, b)) || d.blocks.includes(pair(b, a))
  const friend = (a: string, b: string) =>
    !blocked(a, b) && d.friendships.some((p) => p.includes(a) && p.includes(b))
  const visible = (author: string, audience: Audience) =>
    author === user ||
    (!blocked(author, user) &&
      (audience === 'public' || (audience === 'friends' && friend(author, user))))
  const postVisible = (p: Post) =>
    p.status !== 'deleted' &&
    (p.author.id === user || (p.status === 'published' && visible(p.author.id, p.audience)))
  const spotVisible = (s: Spot) =>
    s.author.id === user ||
    ((!s.status || s.status === 'published') && visible(s.author.id, s.audience))
  const chatCard = (kind: string, target: string, viewer: string) => {
    const item =
      kind === 'post' ? d.posts.find((p) => p.id === target) : d.spots.find((s) => s.id === target)
    if (
      !item ||
      (item.status && item.status !== 'published') ||
      item.audience === 'private' ||
      blocked(item.author.id, viewer) ||
      (item.audience === 'friends' && item.author.id !== viewer && !friend(item.author.id, viewer))
    )
      return null
    return {
      id: item.id,
      type: kind as 'post' | 'spot',
      title: 'kind' in item ? postCaption(item as Post) : item.name,
      detail:
        'title' in item
          ? [item.species, item.method].filter(Boolean).join(' · ')
          : `${item.water_type} · ${item.precision === 'exact' ? '精确位置' : item.precision === 'area' ? '大致水域' : '位置未分享'}`
    }
  }
  const chatProjection = (m: Message) =>
    m.kind === 'post' || m.kind === 'spot'
      ? { ...m, card: chatCard(m.kind, m.card?.id || '', user) }
      : { ...m }
  const decoratePost = (p: Post) => ({
    ...p,
    content_update: updateInfo('post', p.id, p.author.id),
    author: profile(p.author.id),
    liked: d.likes.includes(pair(user, p.id)),
    saved: d.bookmarks.includes(pair(user, p.id)),
    comment_count: d.comments.filter(
      (c) =>
        c.post_id === p.id &&
        !c.deleted_at &&
        (c.status !== 'hidden' || c.author.id === user) &&
        !blocked(c.author.id, user)
    ).length
  })
  const posts = () => d.posts.filter(postVisible).map(decoratePost)
  const commentError = (code: string, status = 400) =>
    new ApiError(serviceErrorMessage(code) || '请重试', status, code)
  const commentsPage = (post: string, cursor = '') => {
    if (!d.posts.some((p) => p.id === post && postVisible(p))) throw commentError('NOT_FOUND', 404)
    const all = d.comments
      .filter(
        (c) =>
          c.post_id === post &&
          !c.deleted_at &&
          (c.status !== 'hidden' || c.author.id === user) &&
          !blocked(c.author.id, user)
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    const key = (c: Comment) => `${c.created_at}|${c.id}`
    const remaining = cursor ? all.filter((c) => key(c) < cursor) : all
    const page = remaining.slice(0, 30)
    return {
      items: page.map((c) => {
        const target = all.find((r) => r.id === c.reply_to_id && r.status !== 'hidden')
        return {
          ...c,
          author: profile(c.author.id),
          reply_to: target
            ? { id: target.id, author: profile(target.author.id), body: (target.body || (target.media?.some(m=>m.kind==='video') ? (target.media.some(m=>m.kind!=='video')?'[图片/视频]':'[视频]') : '[图片]')).slice(0, 160) }
            : null
        }
      }),
      next: remaining.length > 30 ? key(page[29]) : null,
      total: all.length
    }
  }
  const requireUser = () => {
    if (!user) throw new Error('请先登录，草稿会保留')
  }
  const mine = () => {
    requireUser()
    return profile(user)
  }
  const authorItem = () => {
    requireUser()
    const item =
      input.type === 'post'
        ? d.posts.find((p) => p.id === id && p.author.id === user)
        : input.type === 'spot'
          ? d.spots.find((s) => s.id === id && s.author.id === user)
          : input.type === 'trip'
            ? d.trips.find((t) => t.id === id && t.owner_id === user)
            : undefined
    if (!item) throw new ApiError('内容不存在或你暂时无权查看', 404, 'NOT_FOUND')
    return item
  }
  const version = (item: ReturnType<typeof authorItem>) =>
    ('owner_id' in item ? item.revision : item.review_revision) || 1
  const toggle = (list: string[], target: string, enabled: boolean) => {
    const i = list.indexOf(target)
    if (enabled && i < 0) list.push(target)
    if (!enabled && i >= 0) list.splice(i, 1)
  }
  let result: unknown
  if (kind === 'read') {
    switch (action) {
      case 'water_reports': {
        requireUser()
        const items = d.waterReports
          .filter((r) => r.owner_id === user)
          .map(({ owner_id, signature, ...record }) => record)
        if (!id) return { items: items.slice(0, 100) }
        const record = items.find((r) => r.id === id)
        if (!record) throw new Error('内容不存在或你暂时无权查看')
        return record
      }
      case 'edit_content': {
        const item = authorItem()
        const update = d.contentUpdates[updateKey]
        return JSON.parse(
          JSON.stringify({
            item: {
              ...item,
              ...(update?.owner === user ? update.fields : {}),
              ...('owner_id' in item
                ? {}
                : { content_update: updateInfo(input.type as 'post' | 'spot', id, item.author.id) })
            },
            revision: version(item),
            ...('owner_id' in item
              ? {}
              : {
                  publication: {
                    status: item.status || 'published',
                    audience: item.audience,
                    precision: 'precision' in item ? item.precision : null
                  }
                })
          })
        )
      }
      case 'feed': {
        const q = String(input.query || '')
          .trim()
          .toLowerCase()
        let items = posts().filter(
          (p) =>
            p.status === 'published' && (p.title + p.body + p.species).toLowerCase().includes(q)
        )
        if (input.filter === 'following')
          items = items.filter((p) => d.follows.includes(pair(user, p.author.id)))
        if (input.filter === 'city')
          items = items.filter((p) => p.author.city.trim().replace(/市$/, '') === String(input.city || '').trim().replace(/市$/, ''))
        const start = Number(input.cursor || 0)
        return {
          items: items.slice(start, start + 12),
          next: start + 12 < items.length ? String(start + 12) : null
        }
      }
      case 'post': {
        const post = posts().find((p) => p.id === id)
        if (!post) throw new Error('内容不存在或你暂时无权查看')
        const page = commentsPage(id)
        return { post, comments: page.items, comments_next: page.next }
      }
      case 'comments':
        return commentsPage(id, String(input.cursor || ''))
      case 'spots': {
        const q = String(input.query || '').trim()
        const items = d.spots
          .filter(
            (s) =>
              spotVisible(s) &&
              (s.name + s.city + s.species).includes(q) &&
              (!input.type || s.water_type === input.type)
          )
          .map((s) => ({
            ...decorateSpot(s),
            saved: d.spotBookmarks.includes(pair(user, s.id))
          }))
        const origin = input.origin as {longitude:number;latitude:number;crs:string} | undefined
        if (origin) {
          for (const spot of items) {
            if (spot.longitude == null || spot.latitude == null) continue
            const distance = distanceMeters([origin.longitude,origin.latitude],[spot.longitude,spot.latitude])
            if (distance === undefined) continue
            spot.distance_m = Math.round(distance)
            spot.distance_approximate = spot.precision === 'area' && spot.author.id !== user
          }
          items.sort((a,b)=>(a.distance_m??Infinity)-(b.distance_m??Infinity)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))
        }
        return { items: items.slice(0,100), next: null }
      }
      case 'spot': {
        const s = d.spots.find((s) => s.id === id && spotVisible(s))
        if (!s) throw new Error('钓位不存在或你暂时无权查看')
        return {
          ...decorateSpot(s),
          saved: d.spotBookmarks.includes(pair(user, s.id))
        }
      }
      case 'people':
        return d.profiles.filter(
          (p) =>
            p.id !== user &&
            !blocked(p.id, user) &&
            (p.nickname + p.handle + p.city).includes(String(input.query || ''))
        )
      case 'profile': {
        const p = profile(id || user)
        if (!p) throw new Error('这位钓友暂不可见')
        return {
          profile: p,
          following: d.follows.includes(pair(user, p.id)),
          friend: friend(user, p.id),
          blocked: d.blocks.includes(pair(user, p.id)),
          posts: posts().filter((v) => v.author.id === p.id)
        }
      }
      case 'social': {
        requireUser()
        return {
          friends: d.profiles.filter((p) => p.id !== user && friend(user, p.id)),
          requests: d.requests.filter(
            (r) => (r.sender.id === user || r.recipient.id === user) && r.status === 'pending'
          ),
          conversations: d.conversations
            .filter((c) => c.members.includes(user))
            .map((c) => {
              const messages = d.messages.filter((m) => m.conversation_id === c.id)
              const peer = profile(c.members.find((m) => m !== user)!)
              return {
                id: c.id,
                peer,
                last_message: messages.at(-1)?.body || '开始交流鱼情',
                last_at: messages.at(-1)?.created_at || '',
                unread: messages.filter(
                  (m) => m.sender_id !== user && m.sequence > (c.read[user] || 0)
                ).length,
                can_send: friend(user, peer.id)
              }
            })
        }
      }
      case 'messages': {
        requireUser()
        const c = d.conversations.find((c) => c.id === id && c.members.includes(user))
        if (!c) throw new Error('无权读取此会话')
        const records = d.messages
          .filter((m) => m.conversation_id === id)
          .sort((a, b) => a.sequence - b.sequence)
        const page =
          'after' in input
            ? records.filter((m) => m.sequence > Number(input.after)).slice(0, 100)
            : records
                .filter((m) => m.sequence < Number(input.before || Number.MAX_SAFE_INTEGER))
                .slice(-100)
        return page.map(chatProjection)
      }
      case 'message_content': {
        requireUser()
        if (!d.conversations.some((c) => c.id === id && c.members.includes(user)))
          throw new Error('无权读取此会话')
        const ids = Array.isArray(input.ids) ? input.ids.slice(0, 100) : []
        return d.messages
          .filter((m) => m.conversation_id === id && ids.includes(m.id))
          .map(chatProjection)
      }
      case 'library': {
        requireUser()
        return {
          posts: posts().filter((p) =>
            input.type === 'saved' ? d.bookmarks.includes(pair(user, p.id)) : p.author.id === user
          ),
          trips: d.trips.filter((t) => t.owner_id === user),
          spots: d.spots
            .filter((s) =>
              input.type === 'saved'
                ? d.spotBookmarks.includes(pair(user, s.id)) && spotVisible(s)
                : s.author.id === user
            )
            .map(decorateSpot)
        }
      }
      default:
        throw new Error('不支持的读取操作')
    }
  }
  requireUser()
  if(action!=='comment'){
    const selected=Array.isArray(input.media)?input.media as Media[]:[]
    const referenced=[...selected.map(m=>m.id),input.media_id,input.avatar_id].filter(Boolean)
    if(d.comments.some(c=>c.media?.some(m=>referenced.includes(m.id))))throw new ApiError('评论附件不可复用到其他内容',403,'FORBIDDEN')
  }
  switch (action) {
    case 'save_water_report': {
      if (input.consent_version !== REPORT_CONSENT) throw new Error('请先确认私密保存说明')
      if (d.deletedWaterReports.includes(id)) throw new Error('内容不存在或你暂时无权查看')
      const signature = JSON.stringify(input),
        prior = d.waterReports.find((r) => r.id === id)
      if (prior && (prior.owner_id !== user || prior.signature !== signature))
        throw new Error('记录已变化，请重新读取')
      if (!prior) {
        const media = ((input.media || []) as Media[]).map(
          (m) => d.draftPhotos?.find((p) => p.owner === user && p.asset.id === m.id)?.asset
        )
        if (media.some((m) => !m)) throw new Error('照片不可用，请重新选择')
        d.waterReports.unshift({
          ...input,
          id,
          owner_id: user,
          signature,
          media,
          crs: 'GCJ-02',
          status: 'saved',
          revision: 1,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        } as DemoData['waterReports'][number])
      }
      const { owner_id, signature: ignored, ...record } = d.waterReports.find((r) => r.id === id)!
      result = record
      break
    }
    case 'update_water_report': {
      if (input.consent_version !== REPORT_CONSENT) throw new Error('请先确认私密保存说明')
      const record = d.waterReports.find((r) => r.id === id && r.owner_id === user)
      if (!record || d.deletedWaterReports.includes(id)) throw new ApiError('内容不存在或你暂时无权查看', 404, 'NOT_FOUND')
      if (!input.request_id || !Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 1)
        throw new ApiError('修改信息不完整，请重新打开记录', 400, 'INVALID_INPUT')
      const receiptKey = pair(user, String(input.request_id)), signature = JSON.stringify(input), prior = d.waterReportReceipts[receiptKey]
      if (prior) {
        if (prior.report_id !== id || prior.signature !== signature) throw new ApiError('提交内容已变化，请重新读取记录', 409, 'EDIT_REQUEST_REUSED')
      } else {
        if ((record.revision || 1) !== input.expected_revision) throw new ApiError('这条记录已有新版本，你的修改已保留', 409, 'EDIT_CONFLICT')
        const selected = Array.isArray(input.media) ? input.media as Media[] : null
        if (!selected || selected.length > 6 || new Set(selected.map(m => m.id)).size !== selected.length)
          throw new ApiError('附件无效，请重新选择', 400, 'INVALID_INPUT')
        const media = selected.map(m => {
          const asset = record.media.find(p => p.id === m.id) || d.draftPhotos.find(p => p.owner === user && p.asset.id === m.id)?.asset
          const elsewhere = [...d.posts, ...d.trips, ...d.spots, ...d.messages, ...d.waterReports.filter(r => r.id !== id)]
            .some(item => item.media?.some(p => p.id === m.id)) || d.profiles.some(p => p.avatar?.id === m.id)
          if (!asset || elsewhere) throw new ApiError('附件不可用，请重新选择', 403, 'FORBIDDEN')
          return asset
        })
        const fields = { id, category: String(input.category || ''), province: String(input.province || '').trim(), city: String(input.city || '').trim(),
          district: String(input.district || '').trim(), location_label: String(input.location_label || '').trim(),
          longitude: input.longitude === null ? null : Number(input.longitude), latitude: input.latitude === null ? null : Number(input.latitude),
          description: String(input.description || '').trim(), media, observed_local: localReportTime(new Date(String(input.observed_at || ''))) } satisfies WaterReportDraft
        if (Object.keys(validateWaterReport(fields)).length) throw new ApiError('请检查上报内容', 400, 'INVALID_INPUT')
        const { observed_local: ignored, ...changes } = fields
        const removed = record.media.filter(m => !media.some(next => next.id === m.id)).map(m => m.id)
        d.draftPhotos = d.draftPhotos.filter(p => p.owner !== user || !removed.includes(p.asset.id))
        Object.assign(record, changes, { observed_at: input.observed_at, revision: (record.revision || 1) + 1, updated_at: new Date().toISOString() })
        d.waterReportReceipts[receiptKey] = { report_id: id, signature }
      }
      const { owner_id: ignoredOwner, signature: ignoredSignature, ...visibleRecord } = record
      result = visibleRecord
      break
    }
    case 'delete_water_report': {
      const record = d.waterReports.find((r) => r.id === id && r.owner_id === user)
      if (!record) {
        if (d.deletedWaterReportOwners[id] === user) { result = true; break }
        throw new Error('内容不存在或你暂时无权查看')
      }
      d.draftPhotos = d.draftPhotos.filter(p => p.owner !== user || !record.media.some(m => m.id === p.asset.id))
      d.waterReports = d.waterReports.filter((r) => r !== record)
      d.deletedWaterReports.push(id)
      d.deletedWaterReportOwners[id] = user
      for (const [key, receipt] of Object.entries(d.waterReportReceipts)) if (receipt.report_id === id) delete d.waterReportReceipts[key]
      result = true
      break
    }
    case 'update_content':
    case 'discard_content_update':
    case 'withdraw_content': {
      const requestKey = pair(user, String(input.request_id || ''))
      if (!input.request_id) throw new Error('缺少提交标识')
      const signature = JSON.stringify({ action, input }),
        prior = d.authorReceipts[requestKey]
      if (prior) {
        if (prior.signature !== signature)
          throw new ApiError('提交内容已变化，请重新读取记录', 409, 'EDIT_REQUEST_REUSED')
        return prior.result
      }
      const original = authorItem(),
        item = { ...original },
        revision = version(item)
      if (input.revision !== revision)
        throw new ApiError('这条记录已有新版本，你的修改已保留', 409, 'EDIT_CONFLICT')
      const priorUpdate = d.contentUpdates[updateKey]
      if (action === 'discard_content_update') {
        if ('owner_id' in item || !priorUpdate || priorUpdate.owner !== user)
          throw new ApiError('这条记录已有新版本，请重新读取后操作', 409, 'EDIT_CONFLICT')
        item.review_revision = revision + 1
      } else if (action === 'withdraw_content') {
        if ('owner_id' in item) throw new Error('私人日志无需撤回')
        if (priorUpdate?.owner === user) Object.assign(item, priorUpdate.fields)
        item.audience = 'private'
        item.status = 'published'
        item.review_revision = revision + 1
      } else if (input.type === 'spot') {
        const spot = item as Spot
        for (const field of [
          'name',
          'city',
          'location_label',
          'water_type',
          'fishing_status',
          'species',
          'description',
          'fee_note',
          'access_note',
          'observed_on',
          'audience',
          'precision',
          'latitude',
          'longitude'
        ] as const)
          Object.assign(spot, { [field]: input[field] })
        spot.status = 'published'
        if (Array.isArray(input.media))
          spot.media = spotPhotos(input.media as Media[], spot.media, priorUpdate?.fields.media)
        spot.review_revision = revision + 1
      } else {
        const draft = input as unknown as PostDraft
        validateComposition(draft, 'owner_id' in item ? 'trip' : 'post')
        if (
          'owner_id' in item &&
          !('catch_records' in input) &&
          (item.catch_records?.length || 0) > 1
        )
          throw new ApiError('请更新应用后再编辑这份日志', 400, 'CATCH_DETAILS_REQUIRED')
        const catch_records =
          'owner_id' in item
            ? catchRecordsFromDraft({
                ...draft,
                catches: Array.isArray(input.catch_records)
                  ? (input.catch_records as CatchRecord[]).map(freshCatch)
                  : undefined
              })
            : undefined
        Object.assign(item, {
          title: draft.title.trim(),
          body: draft.body.trim(),
          species: draft.species,
          method: draft.method,
          bait: draft.bait,
          occurred_on: draft.occurred_on,
          occurred_at: typeof input.occurred_at === 'string' ? input.occurred_at : null,
          additives: draft.additives || '',
          weight_kg: optionalNumber(draft.weight, 10000),
          media: (draft.media || []).map(
            (m) =>
              ('media' in item ? item.media?.find((old) => old.id === m.id) : undefined) ||
              priorUpdate?.fields.media?.find((old) => old.id === m.id) ||
              d.draftPhotos?.find((p) => p.owner === user && p.asset.id === m.id)?.asset ||
              m
          )
        })
        if ('owner_id' in item) {
          Object.assign(item, catchSummary(catch_records!), { catch_records })
          item.revision = revision + 1
        } else {
          const p = item as Post
          if ('count' in draft) p.count = catchNumber(draft.count, 'count')
          if ('length' in draft) p.length_cm = catchNumber(draft.length, 'length')
          p.kind = draft.kind
          p.location_label = draft.location_label
          p.location_longitude = draft.location_longitude ?? null
          p.location_latitude = draft.location_latitude ?? null
          p.topic = draft.topic || ''
          p.audience = draft.audience
          p.status = 'published'
          p.review_revision = revision + 1
        }
      }
      Object.assign(original, item)
      delete d.contentUpdates[updateKey]
      result = { id, revision: revision + 1 }
      d.authorReceipts[requestKey] = {
        signature,
        result: result as { id: string; revision: number }
      }
      break
    }
    case 'save_post': {
      const draft = input as unknown as PostDraft
      const existing = d.posts.find((p) => p.id === id)
      if (existing) {
        if (existing.author.id !== user) throw new Error('无权修改')
        result = existing
        break
      }
      validateComposition(draft, 'post')
      const p: Post = {
        id,
        author: mine(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        kind: draft.kind,
        species: draft.species,
        method: draft.method,
        bait: draft.bait,
        weight_kg: optionalNumber(draft.weight, 10000),
        count: catchNumber(draft.count, 'count'),
        length_cm: catchNumber(draft.length, 'length'),
        occurred_on: draft.occurred_on,
        location_label: draft.location_label || '不分享位置',
        location_longitude: draft.location_longitude ?? null,
        location_latitude: draft.location_latitude ?? null,
        topic: draft.topic || '',
        additives: draft.additives || '',
        occurred_at: typeof input.occurred_at === 'string' ? input.occurred_at : null,
        audience: draft.audience,
        status: 'published',
        created_at: new Date().toISOString(),
        like_count: 0,
        comment_count: 0,
        liked: false,
        saved: false,
        media: (draft.media || []).map(
          (m) => d.draftPhotos?.find((p) => p.owner === user && p.asset.id === m.id)?.asset || m
        )
      }
      d.posts.unshift(p)
      result = p
      break
    }
    case 'save_trip': {
      const draft = input as unknown as PostDraft
      if (d.deletedTrips.includes(id)) throw new Error('内容不存在或你暂时无权查看')
      const existing = d.trips.find((t) => t.id === id)
      if (existing) {
        if (existing.owner_id !== user) throw new Error('无权修改')
        result = existing
        break
      }
      validateComposition(draft, 'trip')
      const catch_records = catchRecordsFromDraft({
        ...draft,
        catches: Array.isArray(input.catch_records)
          ? (input.catch_records as CatchRecord[]).map(freshCatch)
          : undefined
      })
      result = {
        id,
        owner_id: user,
        title: draft.title,
        body: draft.body,
        occurred_on: draft.occurred_on,
        occurred_at: typeof input.occurred_at === 'string' ? input.occurred_at : null,
        additives: draft.additives || '',
        method: draft.method,
        bait: draft.bait,
        ...catchSummary(catch_records),
        catch_records,
        media: (draft.media || []).map(
          (m) => d.draftPhotos?.find((p) => p.owner === user && p.asset.id === m.id)?.asset || m
        ),
        created_at: new Date().toISOString()
      }
      d.trips.unshift(result as DemoData['trips'][number])
      break
    }
    case 'reaction': {
      const p = d.posts.find((p) => p.id === id && postVisible(p))
      if (!p) throw new Error('内容不可见')
      const list = input.kind === 'like' ? d.likes : d.bookmarks
      const enabled = Boolean(input.enabled)
      const previous = list.includes(pair(user, id))
      toggle(list, pair(user, id), enabled)
      if (input.kind === 'like' && previous !== enabled) p.like_count += enabled ? 1 : -1
      result = decoratePost(p)
      break
    }
    case 'comment': {
      const p = d.posts.find((p) => p.id === String(input.post_id) && postVisible(p))
      if (!p) throw new Error('内容不可见')
      const existing = d.comments.find((c) => c.id === id)
      const body = String(input.body || '').trim(),
        replyId = String(input.reply_to_id || '') || null
      const selected = input.media === undefined ? [] : input.media
      if (typeof input.body !== 'string' || !Array.isArray(selected) || selected.length > 6 || (!body && !selected.length) || body.length > 500
        || new Set(selected.map((m:Media)=>m?.id)).size!==selected.length || selected.some((m:Media)=>!m?.id)) throw commentError('INVALID_INPUT')
      let media:Media[]=[]
      if (existing) {
        if (existing.author.id !== user || existing.post_id !== p.id)
          throw commentError('FORBIDDEN', 403)
        if (existing.deleted_at) throw commentError('NOT_FOUND', 404)
        if (existing.body !== body || (existing.reply_to_id || null) !== replyId || JSON.stringify((existing.media||[]).map(m=>m.id))!==JSON.stringify(selected.map((m:Media)=>m.id)))
          throw commentError('COMMENT_REQUEST_REUSED', 409)
        media=existing.media||[]
      } else if (
        replyId &&
        !d.comments.some(
          (c) =>
            c.id === replyId &&
            c.post_id === p.id &&
            !c.deleted_at &&
            c.status !== 'hidden' &&
            !blocked(c.author.id, user)
        )
      ) {
        throw commentError('COMMENT_REPLY_UNAVAILABLE', 409)
      }
      if(!existing) media=selected.map((m:Media)=>{
        const asset=d.draftPhotos.find(p=>p.owner===user&&p.asset.id===m.id)?.asset
        const attached=[...d.posts,...d.trips,...d.spots,...d.waterReports,...d.messages,...d.comments].some(item=>item.media?.some(p=>p.id===m.id))||d.profiles.some(p=>p.avatar?.id===m.id)
        if(!asset||attached)throw commentError('FORBIDDEN',403)
        return asset
      })
      result = existing || {
        id,
        post_id: p.id,
        author: mine(),
        body,
        media,
        reply_to_id: replyId,
        created_at: new Date().toISOString()
      }
      if (!existing) d.comments.push(result as DemoData['comments'][number])
      break
    }
    case 'delete_comment': {
      const item = d.comments.find(
        (c) => c.id === id && c.author.id === user && c.post_id === input.post_id
      )
      if (!item || !d.posts.some((p) => p.id === item.post_id && postVisible(p)))
        throw commentError('NOT_FOUND', 404)
      item.body = ''
      d.draftPhotos=d.draftPhotos.filter(p=>!item.media?.some(m=>m.id===p.asset.id))
      item.media=[]
      item.deleted_at ||= new Date().toISOString()
      result = true
      break
    }
    case 'save_spot': {
      const draft = input as unknown as SpotDraft
      if (draft.fishing_status && !['allowed', 'prohibited'].includes(draft.fishing_status)) throw new Error('请选择可钓或禁钓')
      const existing = d.spots.find((s) => s.id === id)
      if (existing && existing.author.id !== user) throw new Error('无权修改')
      const requestKey = pair(user, id),
        signature = JSON.stringify({ action, input }),
        prior = d.authorReceipts[requestKey]
      if (prior) {
        if (prior.signature !== signature)
          throw new ApiError('提交内容已变化，请重新读取记录', 409, 'EDIT_REQUEST_REUSED')
        if (!existing) throw new Error('内容不存在或你暂时无权查看')
        return existing
      }
      if (existing) throw new ApiError('这条记录已有新版本，请重新读取后修改', 409, 'EDIT_CONFLICT')
      result = {
        ...draft,
        fishing_status: draft.fishing_status || 'allowed',
        media: spotPhotos(draft.media || []),
        status: 'published',
        author: mine(),
        saved: false,
        created_at: new Date().toISOString()
      }
      d.spots.unshift(result as DemoData['spots'][number])
      d.authorReceipts[requestKey] = { signature, result: { id, revision: 1 } }
      break
    }
    case 'spot_bookmark':
      toggle(d.spotBookmarks, pair(user, id), Boolean(input.enabled))
      result = true
      break
    case 'follow':
      if (id === user || blocked(user, id)) throw new Error('暂时无法关注')
      toggle(d.follows, pair(user, id), Boolean(input.enabled))
      result = true
      break
    case 'friend_request': {
      if (id === user || blocked(user, id)) throw new Error('暂时无法申请')
      if (friend(user, id)) {
        result = true
        break
      }
      const existing = d.requests.find(
        (r) =>
          r.status === 'pending' &&
          [r.sender.id, r.recipient.id].includes(user) &&
          [r.sender.id, r.recipient.id].includes(id)
      )
      if (existing) {
        result = existing
        break
      }
      result = {
        id: createId(),
        sender: mine(),
        recipient: profile(id),
        note: String(input.note || ''),
        status: 'pending',
        created_at: new Date().toISOString()
      }
      d.requests.push(result as DemoData['requests'][number])
      break
    }
    case 'friend_respond': {
      const r = d.requests.find(
        (r) => r.id === id && r.recipient.id === user && r.status === 'pending'
      )
      if (!r) throw new Error('申请状态已变化')
      r.status = input.accept ? 'accepted' : 'rejected'
      if (input.accept && !blocked(user, r.sender.id)) d.friendships.push([user, r.sender.id])
      result = true
      break
    }
    case 'unfriend':
      d.friendships = d.friendships.filter((p) => !(p.includes(user) && p.includes(id)))
      result = true
      break
    case 'block': {
      toggle(d.blocks, pair(user, id), Boolean(input.enabled))
      if (input.enabled) {
        d.friendships = d.friendships.filter((p) => !(p.includes(user) && p.includes(id)))
        d.follows = d.follows.filter((p) => p !== pair(user, id) && p !== pair(id, user))
        d.requests.forEach((r) => {
          if (
            [r.sender.id, r.recipient.id].includes(user) &&
            [r.sender.id, r.recipient.id].includes(id)
          )
            r.status = 'cancelled'
        })
      }
      result = true
      break
    }
    case 'conversation': {
      if (!friend(user, id)) throw new Error('双方成为好友后才能聊天')
      let c = d.conversations.find((c) => c.members.includes(user) && c.members.includes(id))
      if (!c) {
        c = { id: createId(), members: [user, id], read: {} }
        d.conversations.push(c)
      }
      result = c.id
      break
    }
    case 'send_message': {
      const c = d.conversations.find(
        (c) => c.id === String(input.conversation_id) && c.members.includes(user)
      )
      if (!c) throw new Error('无权读取此会话')
      const old = d.messages.find(
        (m) => m.client_id === String(input.client_id) && m.sender_id === user
      )
      if (old) {
        if (old.conversation_id !== c.id) throw new Error('消息标识已被使用')
        result = chatProjection(old)
        break
      }
      if (!friend(user, c.members.find((m) => m !== user)!))
        throw new Error('双方成为好友后才能发送消息')
      const messageKind = String(input.kind || 'text') as NonNullable<Message['kind']>
      let card: Message['card'], media: Media[] | undefined
      if (messageKind === 'post' || messageKind === 'spot') {
        if (c.members.some((viewer) => !chatCard(messageKind, String(input.reference_id), viewer)))
          throw new Error('这条内容当前不能分享给对方')
        card = chatCard(messageKind, String(input.reference_id), user)
      } else if (messageKind === 'image') {
        const pending = d.draftPhotos?.find(
          (p) => p.owner === user && p.asset.id === input.media_id
        )
        if (!pending) throw new Error('照片不可用，请重新选择')
        media = [pending.asset]
        d.draftPhotos = d.draftPhotos!.filter((p) => p !== pending)
      } else if (messageKind !== 'text' || !String(input.body || '').trim())
        throw new Error('消息内容为空')
      result = {
        id: createId(),
        conversation_id: c.id,
        sender_id: user,
        client_id: String(input.client_id),
        sequence:
          Math.max(
            0,
            ...d.messages.filter((m) => m.conversation_id === c.id).map((m) => m.sequence)
          ) + 1,
        kind: messageKind,
        body:
          messageKind === 'text'
            ? String(input.body).trim()
            : messageKind === 'image'
              ? '[图片]'
              : messageKind === 'post'
                ? '[鱼情]'
                : '[钓位]',
        ...(card ? { card } : {}),
        ...(media ? { media } : {}),
        created_at: new Date().toISOString()
      }
      d.messages.push(result as DemoData['messages'][number])
      break
    }
    case 'read_conversation': {
      const c = d.conversations.find((c) => c.id === id && c.members.includes(user))
      if (c) c.read[user] = Math.max(c.read[user] || 0, Number(input.sequence))
      result = true
      break
    }
    case 'update_profile': {
      const p = mine()
      if ('avatar_id' in input) {
        if (input.avatar_id === null) p.avatar = null
        else {
          const asset = d.draftPhotos?.find((photo) => photo.owner === user && photo.asset.id === input.avatar_id)?.asset
          if (!asset || asset.kind === 'video') throw new ApiError(serviceErrorMessage('AVATAR_UNAVAILABLE')!, 400, 'AVATAR_UNAVAILABLE')
          p.avatar = asset
        }
      }
      for (const field of ['nickname', 'city', 'bio', 'method'] as const)
        if (typeof input[field] === 'string') p[field] = String(input[field])
      result = p
      break
    }
    case 'report':
      d.reports.push({ ...input, reporter_id: user })
      result = true
      break
    case 'delete_content': {
      if (d.contentUpdates[updateKey]?.owner === user) delete d.contentUpdates[updateKey]
      if (input.type === 'post') {
        if(d.posts.some(p=>p.id===id&&p.author.id===user)){
          const assets=new Set(d.comments.filter(c=>c.post_id===id).flatMap(c=>(c.media||[]).map(m=>m.id)))
          d.draftPhotos=d.draftPhotos.filter(p=>!assets.has(p.asset.id))
          for(const comment of d.comments.filter(c=>c.post_id===id))comment.media=[]
        }
        d.posts = d.posts.filter((p) => p.id !== id || p.author.id !== user)
      }
      if (input.type === 'spot')
        d.spots = d.spots.filter((p) => p.id !== id || p.author.id !== user)
      if (input.type === 'trip') {
        if (d.trips.some((p) => p.id === id && p.owner_id === user)) d.deletedTrips.push(id)
        d.trips = d.trips.filter((p) => p.id !== id || p.owner_id !== user)
      }
      result = true
      break
    }
    default:
      throw new Error('不支持的写入操作')
  }
  uni.setStorageSync(key, d)
  return result
}
