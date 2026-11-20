import catalog from './data/districts.json'
import { cityOptions } from './cities'
import type { MobileDistrictOption } from '@mobile-core/city-options'
// Store names once in the miniapp package; enrich from the shared city catalog at runtime.
const citiesById=new Map(cityOptions.map(city=>[city.id,city]))
export const districtOptions: readonly MobileDistrictOption[]=catalog.flatMap(([id,name,cityId])=>{
 const city=citiesById.get(cityId!)
 return city?[{id:id!,name:name!,provinceId:city.provinceId,province:city.province,cityId:city.id,city:city.name}]:[]
})
export interface RegionNames {province:string;city:string;district:string}
export function regionId(region:RegionNames){
 const district=districtOptions.find(item=>item.province===region.province&&item.name===region.district&&(!region.city||item.city===region.city))
 if(district)return district.id
 const city=cityOptions.find(item=>item.province===region.province&&item.name===region.city)
 return city?.id||(region.province?`province-${cityOptions.find(item=>item.province===region.province)?.provinceId||''}`:'')
}
export function regionNames(id:string):RegionNames{
 const district=districtOptions.find(item=>item.id===id)
 if(district)return{province:district.province,city:district.city,district:district.name}
 const city=cityOptions.find(item=>item.id===id)
 if(city)return{province:city.province,city:city.name,district:''}
 const province=cityOptions.find(item=>`province-${item.provinceId}`===id)
 return{province:province?.province||'',city:'',district:''}
}
export const regionLabel=(region:RegionNames)=>[...new Set([region.province,region.city,region.district].filter(Boolean))].join(' · ')
