// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";
import { liveVoiceDev } from "./live-vite-plugin";

const tslibCompat = fileURLToPath(new URL("./src/lib/tslib-compat.ts", import.meta.url));

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [liveVoiceDev()],
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

