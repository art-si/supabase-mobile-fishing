// Keep a deliberate accessibility text scale through uni-app's delayed viewport
// font-size updates. This changes presentation only, never business responses.
export async function setH5TextScale(page, pixels) {
  await page.evaluate((size) => {
    const root = document.documentElement
    window.__acceptanceTextSize = `${size}px`
    const apply = () => {
      if (root.style.fontSize !== window.__acceptanceTextSize)
        root.style.setProperty('font-size', window.__acceptanceTextSize, 'important')
    }
    if (!window.__acceptanceTextObserver) {
      window.__acceptanceTextObserver = new MutationObserver(apply)
      window.__acceptanceTextObserver.observe(root, {
        attributes: true,
        attributeFilter: ['style']
      })
    }
    apply()
  }, pixels)
  await page.waitForFunction(
    (expected) => getComputedStyle(document.documentElement).fontSize === `${expected}px`,
    pixels
  )
}
