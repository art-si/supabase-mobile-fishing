import { isDemo } from '@/config'
import type { Payload } from '@/domain/models'
import type { ContentReportReview } from '@/domain/content-reports'
import { ApiError } from './http'
import { sessionRequest, sessionScope, assertSession } from './session'
import { resolvePhotos } from './media'

export async function contentReports<T>(action: string, payload: Payload = {}): Promise<T> {
  if (isDemo) throw new ApiError('体验模式不提交真实社区举报', 0, 'CONTENT_REPORT_DEMO')
  const scope = sessionScope.value
  const data = await sessionRequest<T>('/rest/v1/rpc/fishing_reports', {
    method: 'POST',
    data: { action, payload }
  })
  if (action === 'item') {
    const content = (data as ContentReportReview).content
    if (content) await resolvePhotos([content])
  }
  assertSession(scope)
  return data
}
