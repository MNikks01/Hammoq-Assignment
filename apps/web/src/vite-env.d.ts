/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Show the seeded demo credentials on the sign-in page (enabled in dev builds). */
  readonly VITE_SHOW_DEMO_HINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
