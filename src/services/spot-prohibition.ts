import { sessionRequest } from './session'
import { ApiError } from './http'

export interface SpotProhibition {
  blocked: boolean
  sources: { id: string; title: string; source: 'official' | 'community' | 'spot'; source_url: string; boundary_known: boolean }[]
  checked_at: string
}
export async function checkSpotProhibition(longitude: number, latitude: number): Promise<SpotProhibition> {
  const result = await sessionRequest<SpotProhibition>('/rest/v1/rpc/fishing_spot_creation_check', {
    method: 'POST', timeout: 8000, data: { longitude, latitude }
  }, false)
  if (!result || typeof result.blocked !== 'boolean' || !Array.isArray(result.sources))
    throw new ApiError('禁钓范围暂未核对，请稍后重试。', 503, 'SPOT_BAN_CHECK_UNAVAILABLE')
  return result
}
