import { normalizePhone } from './rules'

export function normalizeLoginIdentifier(value: string) {
  const handle = value.trim().toUpperCase()
  if (/^DY[0-9A-F]{12}$/.test(handle)) return handle
  return normalizePhone(value)
}

export function passwordIssue(value: string) {
  if (value.length < 8 || value.length > 64 || !/[a-z]/i.test(value) || !/\d/.test(value))
    return '密码需为 8–64 位，包含字母和数字'
  // The Auth service hashes UTF-8 passwords; never silently truncate at bcrypt's byte limit.
  const bytes = Array.from(value).reduce((size, character) => {
    const point = character.codePointAt(0)!
    return size + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4)
  }, 0)
  if (bytes > 72) return '密码过长，请减少中文或特殊字符'
  return ''
}

export function maskPhone(value: string) {
  const digits = value.replace(/^\+?86/, '')
  return /^1\d{10}$/.test(digits)
    ? `${digits.slice(0, 3)} **** ${digits.slice(-4)}`
    : '未绑定手机号'
}
