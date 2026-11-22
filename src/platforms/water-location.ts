import { waterSelection } from '@/domain/map'
import { resolveNearbyWater } from '@/services/nearby-water'
import { searchMapWaterPlaces } from '@/services/amap'
import type { MapPoint } from '@/domain/water-geometry'
import { captureEntryLocation } from './entry-location'
// #ifdef H5
import { nearbyWaterPlaces } from './amap'
// #endif

export async function waterAt(point: MapPoint) {
  let readPlaces = searchMapWaterPlaces
  // #ifdef H5
  readPlaces = nearbyWaterPlaces
  // #endif
  const water = await resolveNearbyWater(point, 2000, readPlaces)
  if (!water) throw new Error('附近未找到水域，请在水域地图选点。')
  return waterSelection(water.point, water.name, water.nameUnavailable)
}

export async function locateWaterPlace() {
  const { longitude, latitude } = await captureEntryLocation()
  return waterAt([longitude, latitude])
}
