import { validCoordinates } from '@/domain/rules'
import { districtOptions } from '@/domain/regions'
import { lookupMapRegion } from '@/services/amap'
// #ifdef MP-WEIXIN
import { entryPosition, waitForEntryLocation } from '@/services/entry-location'
import { captureEntryLocation } from './entry-location'
// #endif
// #ifdef H5
import { locate,loadAmap,timed } from './amap'
// #endif
let supported=false
// #ifdef H5 || MP-WEIXIN
supported=true
// #endif
export const canLocateReport=supported
export interface ReportLocation {province:string;city:string;district:string;location_label:string;longitude:number;latitude:number;areaCode?:string}
/** One requested fix for this private draft; no tracking or remote report write. */
export async function locateReport(){
 // #ifdef MP-WEIXIN
 if(canLocateReport){
  // Reuse the real, authorized entry fix (including an entry request still in flight).
  await waitForEntryLocation()
  const position=entryPosition.value ?? await captureEntryLocation()
  return describeReportLocation([position.longitude,position.latitude])
 }
 // #endif
 // #ifdef H5
 if(canLocateReport){
  const {point}=await locate()
  return describeReportLocation(point)
 }
 // #endif
 throw new Error('当前环境可手动选择地区和地点。')
}
/** Resolve administrative fields from the same selected coordinate; never reuse old-city labels. */
export async function describeReportLocation(point: [number, number]): Promise<ReportLocation> {
  if (!validCoordinates(...point)) throw new Error('水域坐标无效，请重新选点。')
  const [longitude, latitude] = point
  // #ifdef H5
  try {
    const sdk = await loadAmap()
    return await timed(new Promise<ReportLocation>((resolve, reject) => {
      new sdk.Geocoder({ extensions: 'base' }).getAddress(point, (status, result) => {
        const address = result.regeocode?.addressComponent
        if (status !== 'complete' || !address?.province) {
          reject(new Error('无法识别所选水域的地区。'))
          return
        }
        const district = districtOptions.find(item => item.id === address.adcode)
        resolve({
          longitude, latitude, province: address.province,
          city: typeof address.city === 'string' && address.city ? address.city : district?.city || address.province,
          district: address.district || district?.name || '', areaCode: address.citycode,
          location_label: result.regeocode?.formattedAddress || ''
        })
      })
    }), '事发地点定位')
  } catch {
    // Static-map selection still works if the JavaScript map or its geocoder is unavailable.
  }
  // #endif
  const address = await lookupMapRegion(longitude, latitude)
  if (!address?.province) throw new Error('无法识别所选水域的地区。')
  const district = districtOptions.find(item => item.id === address.adcode)
  return {
    longitude, latitude, province: address.province, city: address.city || district?.city || address.province,
    district: address.district || district?.name || '', areaCode: address.citycode, location_label: ''
  }
}
