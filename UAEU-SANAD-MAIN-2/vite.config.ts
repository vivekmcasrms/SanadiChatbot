// Shared Vite + TanStack Start config (plugins: tanstackStart, react, tailwind,
// tsconfig paths, nitro). Do not add those plugins again or the app will break
// with duplicates. Extra Vite options go under defineConfig({ vite: { ... } }).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";
import type { ConfigEnv } from "vite";

const tslibCompat = fileURLToPath(new URL("./src/lib/tslib-compat.ts", import.meta.url));

const createConfig = defineConfig({
  // The browser talks directly to SANADIAPI. Generate a static SPA shell and
  // do not package a Nitro/Node/Worker server with the UI release.
  nitro: false,
  tanstackStart: {
    spa: {
      enabled: true,
      // Emit the SPA shell as dist/client/index.html for IIS/static hosting.
      prerender: { outputPath: "/index" },
    },
  },
  vite: {
    worker: { format: "es" },
    optimizeDeps: {
      include: ["@radix-ui/react-progress"],
    },
    resolve: {
      alias: [
        // pdf-lib ships ESM that imports named helpers from tslib. The nested
        // tslib@1 copy is CommonJS-only, while other pdf-lib modules expect an
        // ESM namespace. The compatibility module exposes both a default
        // namespace and named helpers from one absolute, bundled path.
        { find: /^tslib$/, replacement: tslibCompat },
      ],
    },
  },
});

export default async (env: ConfigEnv) => ({
  ...(await createConfig(env)),
  // Keep a running UI's optimized modules separate from builds and test runners.
  // Otherwise a cache rebuild can leave lazy pages importing files that vanished.
  cacheDir: fileURLToPath(
    new URL(
      env.command === "serve" ? "./node_modules/.vite-ui-dev/" : "./node_modules/.vite-ui-build/",
      import.meta.url,
    ),
  ),
});
