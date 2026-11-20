import type { Message, Conversation } from './models'

export function messageStatus(message: Message, conversation: Conversation | null) {
  if (message.delivery === 'sending') return '发送中…'
  if (message.delivery === 'failed') return '未发送'
  const read = conversation?.peer_read_sequence
  return conversation?.can_send &&
    typeof read === 'number' &&
    Number.isSafeInteger(read) &&
    message.sequence > 0 &&
    message.sequence <= read
    ? '已读'
    : '已发送'
}
