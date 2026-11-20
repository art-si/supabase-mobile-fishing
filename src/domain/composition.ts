import type { Media, Post } from './models'
import type { MediaUploadEntry } from '@mobile-core/media-upload'

export const compositionLimits = { title: 60, body: 2000, photos: 9 } as const

/** Display-only label. Never write a guessed title back into the author's content. */
export function postCaption(post: Pick<Post, 'title' | 'body' | 'kind'>): string {
  return (
    post.title.trim() ||
    post.body.trim().replace(/\s+/g, ' ').slice(0, 60) ||
    (post.kind === 'catch' ? '渔获分享' : '钓鱼心得')
  )
}

export type CompositionPhoto = Omit<MediaUploadEntry, 'asset'> & { asset?: Media }

/** Preserve object identity so pending uploads and focus keep referring to the same photo. */
export function moveCompositionPhoto<T>(items: T[], from: number, to: number): boolean {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return false
  items.splice(to, 0, items.splice(from, 1)[0])
  return true
}
