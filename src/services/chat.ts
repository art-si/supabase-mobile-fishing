import { isDemo } from '@/config'
import type { Message, Payload } from '@/domain/models'
import { sessionRequest, sessionScope, assertSession } from './session'
import { read } from './repository'
import { resolvePhotos } from './media'

/** Reauthorize first. Reuse only still-authorized, short-lived in-memory image URLs. */
export async function chatMessages(
  action: 'messages' | 'message_content',
  payload: Payload,
  previous: Message[] = []
): Promise<Message[]> {
  if (isDemo) return read<Message[]>(action, payload)
  const scope = sessionScope.value
  const records = await sessionRequest<Message[]>(
    '/rest/v1/rpc/fishing_read',
    {
      method: 'POST',
      data: { action, payload }
    },
    true
  )
  const sign: { media: NonNullable<Message['media']> }[] = []
  for (const message of records) {
    if (!message.media?.length) continue
    const old = previous.find((m) => m.id === message.id)
    if (
      old?.mediaSignedAt &&
      Date.now() - old.mediaSignedAt < 45000 &&
      message.media.every((a) =>
        old.media?.some((b) => a.id === b.id && a.path === b.path && b.url)
      )
    ) {
      message.media = message.media.map((a) => ({
        ...a,
        url: old.media!.find((b) => b.id === a.id)!.url
      }))
      message.mediaSignedAt = old.mediaSignedAt
    } else {
      sign.push({ media: message.media })
      message.mediaSignedAt = Date.now()
    }
  }
  await resolvePhotos(sign)
  assertSession(scope)
  return records
}

export function clearMessageContent(messages: Message[]): Message[] {
  return messages.map((message) =>
    message.delivery || !message.kind || message.kind === 'text'
      ? message
      : { ...message, card: null, media: [], mediaSignedAt: undefined }
  )
}
