import catalog from './data/cities.json'
import type { MobileCityOption } from '@mobile-core/city-options'
export const cityOptions: readonly MobileCityOption[] = catalog
const normalize = (name: string) => name.trim().replace(/市$/, '')
export function cityOption(name: string) {
  const value = name.trim()
  return cityOptions.find(city => city.name === value) || cityOptions.find(city => normalize(city.name) === normalize(value))
}
