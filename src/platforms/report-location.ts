import { isDemo } from '@/config'
import { validCoordinates } from '@/domain/rules'
import { districtOptions } from '@/domain/regions'
// #ifdef H5
import { locate,loadAmap,timed } from './amap'
// #endif
let supported=false
// #ifdef H5
supported=true
// #endif
export const canLocateReport=supported&&!isDemo
export interface ReportLocation {province:string;city:string;district:string;location_label:string;longitude:number;latitude:number}
/** One requested fix for this private draft; no tracking or remote report write. */
export async function locateReport(){
 // #ifdef H5
 if(canLocateReport){
  const {point}=await locate()
  return describeReportLocation(point)
 }
 // #endif
 throw new Error('当前环境可手动选择地区和地点。')
}
/** Resolve administrative fields from the same selected coordinate; never reuse old-city labels. */
export async function describeReportLocation(point: [number,number]):Promise<ReportLocation>{
 // #ifdef H5
 if(canLocateReport){
  if(!validCoordinates(point[0],point[1]))throw new Error('当前位置不可用，请手动选择地区和地点。')
  const sdk=await loadAmap()
  return timed(new Promise<ReportLocation>((resolve,reject)=>{
   new sdk.Geocoder({extensions:'base'}).getAddress(point,(status,result)=>{
    const address=result.regeocode?.addressComponent
    if(status!=='complete'||!address?.province){reject(new Error('无法识别当前位置，请手动选择地区和地点。'));return}
    const district=districtOptions.find(item=>item.id===address.adcode)
    const city=typeof address.city==='string'&&address.city?address.city:district?.city||address.province
    resolve({province:address.province,city,district:address.district||district?.name||'',location_label:result.regeocode?.formattedAddress||'',longitude:point[0],latitude:point[1]})
   })
  }),'事发地点定位')
 }
 // #endif
 throw new Error('当前环境可手动选择地区和地点。')
}
