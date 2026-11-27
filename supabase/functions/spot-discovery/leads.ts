import { fishingRpc, FishingError } from '../_shared/fishing-edge.ts'
import type { SpotLead, SpotLeadResult } from '../_shared/discovery-contract.ts'

/** Harvesting runs in the background; visitors only read verified published results. */
export async function discoverSpotLeads(_uid: string, city: unknown): Promise<SpotLeadResult> {
  if (typeof city !== 'string' || !/^[\p{Script=Han}]{2,20}$/u.test(city))
    throw new FishingError('INVALID_INPUT', 400)
  const items = await fishingRpc<SpotLead[]>('fishing_list_spot_leads', { city_name: city })
  return { items, status: 'ready' }
}
