import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
  test: {
    environment: "jsdom",
  },

  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./lib"),
    },
  },

  build: {
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "lib/index.ts"),
      name: "FirestoreHooks",
      fileName: (format) => `lib.${format}.js`,
    },

    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ["firebase", "react"],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: { "firebase": "firebase", "react": "react" },
      },
    },
  },
})
