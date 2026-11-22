import { lookupTileWater } from '../../supabase/functions/_shared/water-tiles'
import { waterHitToGcj02, waterQueryPoint, type MapPoint } from '@/domain/water-geometry'

export async function lookupLiveWater(point: MapPoint, maxDistanceM: number) {
  const water = await lookupTileWater(waterQueryPoint(point), maxDistanceM)
  return water && waterHitToGcj02(water, point)
}
