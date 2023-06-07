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
})
