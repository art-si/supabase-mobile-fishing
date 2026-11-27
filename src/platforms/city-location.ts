import { cityOption } from '@/domain/cities'
// #ifdef H5
import { locate, loadAmap, timed } from './amap'
// #endif
let supported = false
// #ifdef H5
supported = true
// #endif
export const canLocateCity = supported
/** Resolve only the administrative city; coordinates are never saved to the profile. */
export async function locateCity() {
  // #ifdef H5
  if (canLocateCity) {
    const { point } = await locate()
    const sdk = await loadAmap()
    return timed(new Promise<string>((resolve,reject) => new sdk.Geocoder({ extensions: 'base' }).getAddress(point,(status,result) => {
      const address = result.regeocode?.addressComponent
      const names = [typeof address?.city === 'string' ? address.city : '', address?.district, address?.province]
      const option = names.flatMap(name => name ? [cityOption(name)] : []).find(Boolean)
      if (status === 'complete' && option) resolve(option.id)
      else reject(new Error('无法识别所在城市，请手动选择。'))
    })), '城市定位')
  }
  // #endif
  throw new Error('当前环境可手动选择城市。')
}
