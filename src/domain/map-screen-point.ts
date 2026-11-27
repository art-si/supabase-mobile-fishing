type Point = {longitude:number;latitude:number}
type Size = {width:number;height:number}
export type MapScreenBounds = {southwest:Point;northeast:Point}
const mercator=(latitude:number)=>Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360))
/** Native map is north-up with no tilt. Project against its observed visible bounds. */
export function mapScreenPoint(point:Point,bounds:MapScreenBounds,size:Size){
 const span=bounds.northeast.longitude-bounds.southwest.longitude
 const top=mercator(bounds.northeast.latitude),bottom=mercator(bounds.southwest.latitude)
 if(!(span>0 && top>bottom && size.width>0 && size.height>0))return
 return {x:(point.longitude-bounds.southwest.longitude)/span*size.width,
  y:(top-mercator(point.latitude))/(top-bottom)*size.height}
}
export function mapCoordinate(point:{x:number;y:number},bounds:MapScreenBounds,size:Size){
 const span=bounds.northeast.longitude-bounds.southwest.longitude
 const top=mercator(bounds.northeast.latitude),bottom=mercator(bounds.southwest.latitude)
 if(!(span>0 && top>bottom && size.width>0 && size.height>0))return
 return {longitude:bounds.southwest.longitude+point.x/size.width*span,
  latitude:(2*Math.atan(Math.exp(top-point.y/size.height*(top-bottom)))-Math.PI/2)*180/Math.PI}
}
