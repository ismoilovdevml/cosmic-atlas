/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** build-time tile origin, e.g. https://tiles.example.org/ (src/data/tilebase.ts); default tiles/ */
  readonly VITE_TILE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
