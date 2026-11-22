import { loadFishingAi } from '../_shared/fishing-ai.ts'
import { fishingRpc } from '../_shared/fishing-edge.ts'
import { createSpotSourceImportHandler } from './handler.ts'

Deno.serve(createSpotSourceImportHandler({
  // The Art credential RPC allows service-role callers only.
  loadAi: loadFishingAi,
  publish: (items, token) => fishingRpc<number>('fishing_publish_spot_leads', { cards: items }, token)
}))
