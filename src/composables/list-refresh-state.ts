import type { InjectionKey, Ref } from 'vue'

/** Per-page state; never let a hidden page control the next page's indicator. */
export const listRefreshingKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('fishing-list-refreshing')
