// Hosted Web Service acceptance through the actual static-map page.
// Uses only the ordinary temporary session supplied by the shared harness.
// The browser supplies the entry location. Map search, images and weather use the live provider.
import { setH5TextScale } from './h5-text-scale.mjs'

export async function amapWebServiceFlow({ page, project, button, field, go, shot, fits, check, setPhase }) {
  function responseFor(action) {
    return page.waitForResponse(reply => {
      if (reply.url() !== `${project}/functions/v1/amap` || reply.request().method() !== 'POST') return false
      try { return reply.request().postDataJSON()?.action === action } catch { return false }
    }, { timeout: 50000 })
  }
  async function decodedMap() {
    await page.waitForFunction(() => {
      const image = document.querySelector('.static-map-image img')
      return image?.complete && image.naturalWidth === 640 && image.naturalHeight === 360
    }, null, { timeout: 30000 })
  }
  setPhase('amap-live-search')
  await go(page, '/pages/map/search')
  const searched = responseFor('search')
  await field(page, '搜索高德地点').fill('苏州金鸡湖')
  const searchResponse = await searched
  check(searchResponse.status() === 200, 'Static-map search reaches the real authenticated AMap Edge Function')
  const result = await searchResponse.json()
  check(result.source === 'amap' && result.items?.length > 0 && result.items.some(item => item.name.includes('金鸡湖')), 'Real AMap search returns matching public places')
  check(result.items.every(item => item.crs === 'GCJ-02' && Number.isFinite(item.longitude) && Number.isFinite(item.latitude)), 'Search selections carry valid GCJ-02 coordinates')
  check(/^[1-9]\d{5}$/.test(result.items[0].adcode || ''), 'Selected real POI carries the provider region required for weather')
  check(Object.keys(result).sort().join(',') === 'hasMore,items,source', 'Search returns the public projection without provider configuration')
  check(await button(page, '搜索').count() === 0, 'Typing searches directly without a separate search text button')

  setPhase('amap-static-preview')
  const previewed = responseFor('preview')
  await page.getByRole('option').first().click()
  const previewResponse = await previewed
  check(previewResponse.status() === 200, 'Selecting a real place automatically loads the hosted static map')
  const preview = await previewResponse.json()
  check(preview.source === 'amap' && preview.width === 640 && preview.height === 360 && /^data:image\/(png|jpeg);base64,/.test(preview.image || ''), 'Static map is real image data with the expected dimensions')
  check(Object.keys(preview).sort().join(',') === 'height,image,precision,source,width,zoom', 'Static preview contains image data rather than a credential-bearing provider URL')
  await decodedMap()
  check(true, 'Browser decodes and renders the real 640 by 360 static map')

  setPhase('amap-static-zoom')
  const zoomed = responseFor('preview')
  await button(page, '缩小静态地图').click()
  const zoomResponse = await zoomed
  check(zoomResponse.status() === 200 && (await zoomResponse.json()).zoom === preview.zoom - 1, 'Static map zoom fetches a new image from the live provider')
  await decodedMap()

  setPhase('amap-live-weather')
  const weatherReady = responseFor('weather')
  await button(page, '查看天气').click()
  const weatherResponse = await weatherReady
  check(weatherResponse.status() === 200, 'Weather for the selected place reaches the real Web Service proxy')
  const weather = await weatherResponse.json()
  check(weather.source === 'amap' && /^[1-9]\d{5}$/.test(weather.adcode) && Number.isFinite(Date.parse(weather.reportedAt)) && !!weather.city, 'Real weather includes its region and provider observation time')
  await page.locator('.weather-region').waitFor()
  check((await page.locator('.weather-region').innerText()).includes(weather.city), 'The page displays weather from the actual service response')

  setPhase('amap-viewports')
  for (const [label, width, height, dark, textSize] of [
    ['375',375,812,false,16], ['320',320,740,false,16], ['440',440,956,false,16],
    ['landscape',844,390,false,16], ['wide',1280,900,false,16], ['dark-large-320',320,812,true,24]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, textSize)
    await decodedMap()
    await fits(`Live static map fits ${label}`)
    await shot(`amap-web-service-${label}`)
  }
}
