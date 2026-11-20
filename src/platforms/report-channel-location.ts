import type { ReportChannel } from '@/domain/report-channels'
import { matchChannelOffice, type ChannelLocations } from '@/domain/report-channel-location'
// #ifdef H5
import { searchPlaces } from './amap'
// #endif

const cache=new Map<string,{at:number;point:ChannelLocations[string]|undefined}>()
/** Public agency name only; no private incident text or coordinates are sent to the map search. */
export async function locateReportChannels(channels:readonly ReportChannel[]):Promise<ChannelLocations>{
 const found:ChannelLocations={}
 // #ifdef H5
 const queue=channels.filter(c=>c.officeName&&c.city)
 await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
  let channel:ReportChannel|undefined
  while((channel=queue.shift())){
   const current=channel, saved=cache.get(current.id)
   if(saved && Date.now()-saved.at<10*60*1000){if(saved.point)found[current.id]=saved.point;continue}
   try{
    const pois=await searchPlaces(`${current.city} ${current.officeName}`)
    const point=matchChannelOffice(current,pois.map(p=>({name:p.name,cityname:p.cityname,adname:p.adname,longitude:p.location?.getLng(),latitude:p.location?.getLat()})))
    cache.set(current.id,{at:Date.now(),point})
    if(point)found[current.id]=point
   }catch{/* No verified map match: preserve jurisdiction order, never synthesize distance. */}
  }
 }))
 // #endif
 return found
}
