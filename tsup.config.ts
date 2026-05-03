import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['hono', 'zod', 'reflect-metadata'],
  esbuildOptions(options) {
    options.target = 'es2022';
  },
  tsconfig: './tsconfig.json',
});
