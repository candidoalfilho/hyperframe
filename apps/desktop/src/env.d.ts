/// <reference types="vite/client" />

/** injetado pelo Vite (define) a partir do package.json do desktop */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** "1" força a build web (sem recursos exclusivos do desktop) */
  readonly VITE_WEB_BUILD?: string
}
