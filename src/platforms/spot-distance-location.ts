import { isDemo } from '@/config'
// #ifdef H5
import { locate } from './amap'
// #endif
export async function locateSpotDistance() {
  // #ifdef H5
  if (!isDemo) {
    const { point } = await locate()
    return { longitude: point[0], latitude: point[1], crs: 'GCJ-02' as const }
  }
  // #endif
  throw new Error('当前环境请在地点搜索中选择你的位置。')
}
