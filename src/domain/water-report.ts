import type { Media } from './models'
import { createId, validCoordinates, validDate } from './rules'

export const REPORT_CONSENT = '2026-11-19-water-v1'
export const reportCategories = [
  { id: 'electric', name: '疑似电鱼' },
  { id: 'net', name: '疑似违规网捕' },
  { id: 'poison', name: '疑似毒鱼／炸鱼' },
  { id: 'other', name: '其他水域问题' }
]
export const reportProvinces = [
  '北京市',
  '天津市',
  '河北省',
  '山西省',
  '内蒙古自治区',
  '辽宁省',
  '吉林省',
  '黑龙江省',
  '上海市',
  '江苏省',
  '浙江省',
  '安徽省',
  '福建省',
  '江西省',
  '山东省',
  '河南省',
  '湖北省',
  '湖南省',
  '广东省',
  '广西壮族自治区',
  '海南省',
  '重庆市',
  '四川省',
  '贵州省',
  '云南省',
  '西藏自治区',
  '陕西省',
  '甘肃省',
  '青海省',
  '宁夏回族自治区',
  '新疆维吾尔自治区',
  '香港特别行政区',
  '澳门特别行政区',
  '台湾省'
]
export interface WaterReportDraft {
  id: string
  category: string
  province: string
  city: string
  district: string
  location_label: string
  longitude: number | null
  latitude: number | null
  observed_local: string
  description: string
  media: Media[]
}
export interface WaterReport extends Omit<WaterReportDraft, 'observed_local'> {
  observed_at: string
  created_at: string
  status: 'saved'
  crs: 'GCJ-02'
  revision?: number
  updated_at?: string
}
export function localReportTime(date = new Date()) {
  const n = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${n(date.getMonth() + 1)}-${n(date.getDate())} ${n(date.getHours())}:${n(date.getMinutes())}`
}
export function reportTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) || !validDate(value.slice(0, 10))) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isFinite(date.getTime()) && localReportTime(date) === value
    ? date.toISOString()
    : null
}
export function freshWaterReport(now = new Date()): WaterReportDraft {
  return {
    id: createId(),
    category: 'electric',
    province: '',
    city: '',
    district: '',
    location_label: '',
    longitude: null,
    latitude: null,
    observed_local: localReportTime(now),
    description: '',
    media: []
  }
}
/** Empty auto-saved defaults are not an incident draft. Explicit edits and evidence are. */
export function hasWaterReportContent(draft: Partial<WaterReportDraft> & { _edited?: boolean }) {
  return Boolean(draft._edited || draft.description?.trim() || draft.media?.length)
}
export function waterReportDraftFromRecord(report: WaterReport): WaterReportDraft {
  return {
    id: report.id,
    category: report.category,
    province: report.province,
    city: report.city,
    district: report.district,
    location_label: report.location_label,
    longitude: report.longitude,
    latitude: report.latitude,
    observed_local: localReportTime(new Date(report.observed_at)),
    description: report.description,
    media: report.media.map(asset => ({ ...asset }))
  }
}
export function validateWaterReport(d: WaterReportDraft, now = Date.now()) {
  const errors: Record<string, string> = {}
  if (!reportCategories.some((c) => c.id === d.category)) errors.category = '请选择问题类型'
  if (!reportProvinces.includes(d.province)) errors.province = '请选择事发省级地区'
  if (!d.city.trim() || d.city.length > 40) errors.city = '请填写事发城市，不是当前所在地'
  if (d.district.length > 40) errors.district = '区县名称不能超过40字'
  if (!d.location_label.trim() || d.location_label.length > 200)
    errors.location_label = '请说明水域名称、岸段或附近标志物'
  if ((d.longitude !== null || d.latitude !== null) && !validCoordinates(d.longitude, d.latitude))
    errors.location = '位置无效，请重新选点或清除位置后手填地址'
  const time = reportTimestamp(d.observed_local)
  if (!time || Date.parse(time) > now + 300000)
    errors.observed_local = '请填写有效的事发时间，不能晚于当前时间'
  if (d.description.trim().length < 5 || d.description.length > 2000)
    errors.description = '请客观描述亲眼看到的情况，至少5个字'
  if (d.media.length > 6) errors.media = '图片和视频最多添加6项'
  return errors
}
export function waterReportPayload(d: WaterReportDraft) {
  const { observed_local, media, ...fields } = d
  return {
    ...fields,
    observed_at: reportTimestamp(observed_local),
    media: media.map(({ id }) => ({ id })),
    consent_version: REPORT_CONSENT
  }
}
export function reportMaterial(r: WaterReport) {
  return [
    '水域问题线索（请主管单位核实）',
    `问题：${reportCategories.find((c) => c.id === r.category)?.name || '其他水域问题'}`,
    `时间：${localReportTime(new Date(r.observed_at))}`,
    `地区：${r.province} ${r.city} ${r.district}`,
    `地点：${r.location_label}`,
    validCoordinates(r.longitude, r.latitude)
      ? `坐标（GCJ-02）：${r.longitude}, ${r.latitude}`
      : '坐标：未提供，请按文字地点核实',
    `情况：${r.description}`,
    `附件：${r.media.filter(item=>item.kind!=='video').length}张图片、${r.media.filter(item=>item.kind==='video').length}段视频，需在官方渠道另行提交。`
  ].join('\n')
}
