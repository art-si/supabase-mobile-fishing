// Reproducible offline choices; no device location or network calls.
import { areaList } from '@vant/area-data'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const root=new URL('../src/domain/data/',import.meta.url)
await mkdir(root,{recursive:true})
const cities=[],districts=[]
const children=prefix=>Object.entries(areaList.county_list).filter(([id])=>id.startsWith(prefix))
const addCity=(id,name,provinceId,province,items)=>{
 const city={id,name,provinceId,province};cities.push(city)
 districts.push(...items.map(([code,district])=>({id:code,name:district,provinceId,province,cityId:id,city:name})))
}
for(const[provinceId,province]of Object.entries(areaList.province_list)){
 if(['110000','120000','310000','500000','810000','820000'].includes(provinceId)){
  addCity(provinceId,province,provinceId,province,children(provinceId.slice(0,2)));continue
 }
 for(const[id,name]of Object.entries(areaList.city_list).filter(([id])=>id.startsWith(provinceId.slice(0,2)))){
  if(/直辖县|直辖行政/.test(name))for(const[code,county]of children(id.slice(0,4)))addCity(code,county,provinceId,province,[[code,county]])
  else addCity(id,name,provinceId,province,children(id.slice(0,4)))
 }
}
if(new Set(cities.map(c=>c.provinceId)).size!==34||cities.length<380||districts.length<3400)throw Error('Incomplete area data')
const cityById=new Map(cities.map(city=>[city.id,city]))
const packed=districts.map(item=>[item.id,item.name,item.cityId])
const restored=packed.map(([id,name,cityId])=>{
 const city=cityById.get(cityId)
 if(!city)throw Error('Missing district parent')
 return{id,name,provinceId:city.provinceId,province:city.province,cityId:city.id,city:city.name}
})
assert.deepEqual(restored,districts,'Compact encoding must preserve every region and parent')
for(const[name,data]of[['cities',cities],['districts',districts]]){
 await writeFile(new URL(name+'.json',root),JSON.stringify(name==='districts'?packed:data))
 await writeFile(new URL(name+'.source.json',root),JSON.stringify({source:'@vant/area-data',version:'2.2.0',dataset:'2025 administrative names',license:'MIT',reference:'https://github.com/vant-ui/vant/tree/main/packages/vant-area-data',generated:new Date().toISOString().slice(0,10),count:data.length,note:'Offline administrative names. No coordinates. Legacy values remain until edited.'},null,2))
}
await writeFile(new URL('area-data.LICENSE.txt',root),await readFile(new URL('../node_modules/@vant/area-data/LICENSE',import.meta.url)))
console.log(`Generated ${cities.length} city and ${districts.length} district options in 34 province-level groups`)
