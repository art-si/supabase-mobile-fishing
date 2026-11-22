import { resolve } from 'node:path'
import { resolveMobileProRoot as resolvePlatformRoot } from 'supabase-mobile-pro/scripts/consumer.mjs'

export const applicationRoot = resolve(import.meta.dirname, '..')
export const resolveMobileProRoot = () => resolvePlatformRoot(applicationRoot)
