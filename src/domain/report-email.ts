export interface ReportEmailContact { name: string; email: string }

export function normalizeReportEmailContact(value: ReportEmailContact): ReportEmailContact {
  return { name: value.name.trim(), email: value.email.trim() }
}
export function validateReportEmailContact(value: ReportEmailContact) {
  const clean = normalizeReportEmailContact(value), errors: Partial<Record<keyof ReportEmailContact, string>> = {}
  if (!clean.name || clean.name.length > 40 || /[\r\n\u0000-\u001f]/.test(clean.name)) errors.name = '请填写称呼，最多40字'
  if (clean.email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(clean.email)
    || clean.email.split('@')[0].length > 64 || clean.email.startsWith('.') || clean.email.includes('..') || clean.email.includes('.@'))
    errors.email = '请填写有效邮箱，例如 name@example.com'
  return errors
}
