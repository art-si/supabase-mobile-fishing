declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number
    get_height(): number
    is_primary?(): boolean
    free?(): void
    display(
      frame: { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> },
      done: (
        result: { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null
      ) => void
    ): void
  }
  export default function createHeif(options?: {
    print?: (...values: unknown[]) => void
    printErr?: (...values: unknown[]) => void
  }): Promise<{ HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] } }>
}
