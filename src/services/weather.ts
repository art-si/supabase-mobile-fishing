import { validCoordinates } from '@/domain/rules'
import { readWeatherResponse, validAdcode, type WeatherTarget } from '@/domain/weather'
import { sessionRequest } from './session'
// #ifdef H5
import { currentWeatherAt } from '@/platforms/amap'
// #endif
export async function getCurrentWeather(target: WeatherTarget, staticMode = false) {
  if (
    'adcode' in target
      ? !validAdcode(target.adcode)
      : !validCoordinates(target.longitude, target.latitude)
  )
    throw new Error('WEATHER_REGION_UNAVAILABLE')
  // #ifdef H5
  if (!staticMode) return currentWeatherAt(target)
  // #endif
  if (!('adcode' in target)) throw new Error('WEATHER_REGION_UNAVAILABLE')
  const data = await sessionRequest<unknown>('/functions/v1/amap', {
    method: 'POST',
    data: { action: 'weather', adcode: target.adcode }
  })
  const weather = readWeatherResponse(data, target.adcode)
  if (!weather) throw new Error('WEATHER_RESPONSE_INVALID')
  return weather
}
