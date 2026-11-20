import { reportMaterial, reportCategories, type WaterReport } from './water-report'
import type { ReportEmailContact } from './report-email'
export function reportMailto(recipient:string,contact:ReportEmailContact,report?:WaterReport|null){
 const valid=(email:string)=>/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(email)&&!/[\r\n]/.test(email)
 if(!valid(recipient)||!valid(contact.email))throw new Error('请检查邮箱地址')
 const title=report?`${report.city}${report.district} ${reportCategories.find(c=>c.id===report.category)?.name||'水域线索'}`:'水域问题线索'
 const body=[report?reportMaterial(report):'请补充事发时间、具体水域与亲眼所见的情况。',`联系人：${contact.name.trim()}`,`联系邮箱：${contact.email.trim()}`,'图片和视频请在邮件中另行添加原始附件。'].join('\n\n')
 // mailto has no reliable From/attachment fields. The user's mail app owns sender and final send.
 return `mailto:${encodeURIComponent(recipient).replace(/%40/g,'@')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}
