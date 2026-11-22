import { distanceMeters } from '@mobile-core/coordinates'
import type { ReportChannel } from './report-channels'
import { reportChannelSpecificity } from './report-channels'

export interface ChannelPoint { longitude: number; latitude: number }
export type ChannelLocations = Record<string, ChannelPoint>
export function channelDistance(origin: ChannelPoint | null | undefined, point: ChannelPoint | undefined) {
  if (!origin || !point) return undefined
  return distanceMeters([origin.longitude, origin.latitude], [point.longitude, point.latitude])
}
export function rankedReportChannels(channels: readonly ReportChannel[], origin?:ChannelPoint|null, locations:ChannelLocations={}) {
  return [...channels].sort((a,b)=>reportChannelSpecificity(b)-reportChannelSpecificity(a) ||
    (channelDistance(origin,locations[a.id])??Infinity)-(channelDistance(origin,locations[b.id])??Infinity))
}
export function channelDistanceLabel(distance?:number){
  if(distance===undefined)return ''
  if(distance<1000)return `距所选水域约${Math.round(distance/10)*10}米`
  return `距所选水域约${distance<10000?(distance/1000).toFixed(1):Math.round(distance/1000)}公里`
}
export interface ChannelPoi extends ChannelPoint { name:string; cityname?:string; adname?:string }
const normalized=(value:string)=>value.replace(/[\s·（）()]/g,'')
/** Only exact agency identities in the selected city are usable. Ambiguous POIs give no distance. */
export function matchChannelOffice(channel:ReportChannel,pois:ChannelPoi[]):ChannelPoint|undefined{
  if(!channel.officeName || !channel.city)return
  const city=channel.city.replace(/市$/,'')
  const names=[normalized(channel.officeName),normalized(channel.city+channel.officeName)]
  const matches=pois.filter(p=>names.includes(normalized(p.name)) &&
    p.cityname?.replace(/市$/,'')===city &&
    (!channel.district || p.adname?.replace(/(市|区|县)$/,'')===channel.district.replace(/(市|区|县)$/,'')) &&
    channelDistance(p,p)!==undefined)
  return matches.length===1?{longitude:matches[0].longitude,latitude:matches[0].latitude}:undefined
}
