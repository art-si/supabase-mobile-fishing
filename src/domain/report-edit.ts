import { waterReportPayload, type WaterReportDraft } from './water-report'

/** Keep requestId unchanged for a retry of the same user edit. */
export function updateWaterReportPayload(draft: WaterReportDraft, revision: number, requestId: string) {
  return { ...waterReportPayload(draft), expected_revision: revision, request_id: requestId }
}
