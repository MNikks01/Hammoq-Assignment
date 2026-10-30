import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    seed: 'src/scripts/seed.ts',
    'sync-indexes': 'src/scripts/sync-indexes.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: true,
  // The shared contracts package ships TypeScript source, so it must be bundled.
  noExternal: ['@taskmanager/contracts'],
});
