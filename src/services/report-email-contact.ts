import { isDemo } from '@/config'
import { normalizeReportEmailContact, validateReportEmailContact, type ReportEmailContact } from '@/domain/report-email'

const key = (owner: string) => `dyj.${isDemo ? 'demo' : 'live'}.draft.${owner}.report-email-contact`
export function readReportEmailContact(owner: string): ReportEmailContact | null {
  if (!owner) return null
  const value = uni.getStorageSync(key(owner))
  if (!value || typeof value.name !== 'string' || typeof value.email !== 'string') return null
  if (Object.keys(validateReportEmailContact(value)).length) return null
  return normalizeReportEmailContact(value)
}
export function saveReportEmailContact(owner: string, value: ReportEmailContact) {
  if (!owner || Object.keys(validateReportEmailContact(value)).length) throw new Error('请先完成邮箱资料')
  const contact = normalizeReportEmailContact(value)
  uni.setStorageSync(key(owner), contact)
  return contact
}
export function clearReportEmailContact(owner: string) {
  if (owner) uni.removeStorageSync(key(owner))
}
