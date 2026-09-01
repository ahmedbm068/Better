import type { ImHimApi } from '@shared/api'

declare global {
  interface Window {
    api: ImHimApi
  }
}

export {}
