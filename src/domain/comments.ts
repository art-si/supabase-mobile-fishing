import type { Comment } from './models'

export interface CommentAttempt {
  id: string
  post_id: string
  body: string
  reply_to_id: string | null
  media: { id: string }[]
}
/** An unchanged retry has the same command identity; editing never silently reuses it. */
export function commentAttempt(
  previous: CommentAttempt | undefined,
  post: string,
  body: string,
  reply: string | null,
  newId: () => string,
  media: readonly {id:string}[] = []
): CommentAttempt {
  const text = body.trim()
  const attachments=media.map(asset=>({id:asset.id}))
  if (previous?.post_id === post && previous.body === text && previous.reply_to_id === reply && JSON.stringify(previous.media||[])===JSON.stringify(attachments))
    return previous
  return { id: newId(), post_id: post, body: text, reply_to_id: reply, media:attachments }
}
export function mergeComments(existing: Comment[], older: Comment[]) {
  const ids = new Set(existing.map((item) => item.id))
  return [...existing, ...older.filter((item) => !ids.has(item.id))]
}
