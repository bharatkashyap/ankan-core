/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string
  readonly VITE_MCP_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
