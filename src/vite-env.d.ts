/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIX_HOST_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
