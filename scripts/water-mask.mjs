import { mkdir,readFile,writeFile } from 'node:fs/promises'
import clipping from 'polygon-clipping'
const directory='artifacts/map-fences/sources'
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1]
function stitch(parts){
 const pending=parts.map(p=>p.map(({lon,lat})=>[lon,lat])),rings=[]
 while(pending.length){
  let ring=pending.shift()
  while(!same(ring[0],ring.at(-1))){
   const index=pending.findIndex(p=>same(p[0],ring.at(-1))||same(p.at(-1),ring.at(-1)))
   if(index<0)throw Error('Water boundary has unclosed outer members')
   const next=pending.splice(index,1)[0]
   if(!same(next[0],ring.at(-1)))next.reverse()
   ring.push(...next.slice(1))
  }
  rings.push(ring)
 }
 return rings
}
function contains(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside
}return inside}
function polygons(element){
 if(element.type==='way')return element.geometry?.length>3&&same([element.geometry[0].lon,element.geometry[0].lat],[element.geometry.at(-1).lon,element.geometry.at(-1).lat])?[[element.geometry.map(({lon,lat})=>[lon,lat])]]:[]
 if(element.type!=='relation')return[]
 const members=element.members.filter(m=>m.type==='way'&&m.geometry)
 const outer=stitch(members.filter(m=>m.role==='outer'||!m.role).map(m=>m.geometry))
 const inner=stitch(members.filter(m=>m.role==='inner').map(m=>m.geometry))
 return outer.map(ring=>[ring,...inner.filter(hole=>contains(hole[0],ring))])
}
export async function clipToWater(id,name,policyRing,identity){
 await mkdir(directory,{recursive:true})
 const file=`${directory}/${id}-water.json`
 let data
 try{data=JSON.parse(await readFile(file,'utf8'))}catch{
  const xs=policyRing.map(p=>p[0]),ys=policyRing.map(p=>p[1])
  const bounds=[Math.min(...ys)-.01,Math.min(...xs)-.01,Math.max(...ys)+.01,Math.max(...xs)+.01].join(',')
  const [south,west,north,east]=bounds.split(',')
  const response=await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`,{
    headers:{'Accept':'application/json','User-Agent':'Diaoyouji/0.1 (water-surface boundary verification; local development)'},
    signal:AbortSignal.timeout(35000)
  })
  if(!response.ok)throw Error(`Water source unavailable (${response.status}): ${(await response.text()).slice(0,150)}`)
  data=await response.json();await writeFile(file,JSON.stringify(data))
 }
 const nodes=new Map(data.elements.filter(e=>e.type==='node').map(e=>[e.id,{lon:e.lon,lat:e.lat}]))
 const ways=new Map(data.elements.filter(e=>e.type==='way').map(e=>[e.id,{...e,geometry:e.geometry||e.nodes?.map(id=>nodes.get(id))}]))
 data.elements=data.elements.filter(e=>e.tags?.natural==='water').map(e=>e.type==='way'?ways.get(e.id):e.type==='relation'?{...e,members:e.members.map(m=>({...m,geometry:m.geometry||ways.get(m.ref)?.geometry}))}:e)
 if(identity?.aliases?.length&&!identity.source_url)throw Error('Water aliases require a reviewed identity source')
 const names=[name,...(identity?.aliases||[])]
 const candidates=data.elements.filter(e=>[e.tags?.name,e.tags?.['name:zh'],e.tags?.alt_name].filter(Boolean).some(label=>label.split(';').some(v=>names.some(n=>v===n||v===n+'水库'))))
 if(!candidates.length)throw Error(`No matching water boundary for ${name}; available: ${data.elements.map(e=>e.tags?.name).filter(Boolean).join('、')}`)
 const shapes=candidates.flatMap(polygons)
 if(!shapes.length)throw Error('No complete water polygons')
 const mask=clipping.union(...shapes)
 const result=clipping.intersection([policyRing],mask)
 if(!result.length)throw Error('Policy boundary does not overlap the named water')
 return { polygons:result, provenance:{ source:'OpenStreetMap',license:'ODbL-1.0',url:'https://www.openstreetmap.org/copyright',checked_on:'2026-11-20',features:candidates.map(e=>({type:e.type,id:e.id,name:e.tags.name})),...(identity?{identity}:{}),timestamp:data.osm3s?.timestamp_osm_base } }
}
if(process.argv.includes('--probe')){
 const data=JSON.parse(await readFile('data/official-zones/verified.json','utf8'))
 const row=data.records[0]
 const result=await clipToWater(row.id,'团氿',row.provenance.original_geographic_points.concat([row.provenance.original_geographic_points[0]]))
 console.log(JSON.stringify({components:result.polygons.map(p=>p.map(r=>r.length)),provenance:result.provenance},null,2))
}
