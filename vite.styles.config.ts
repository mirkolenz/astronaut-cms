import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The admin's stylesheet, compiled here so a site gets plain CSS, its fonts next
// to it, and no Tailwind plugin of ours in its own build.
export default defineConfig({
  plugins: [tailwindcss()],
  base: "./",
  build: {
    outDir: "dist/astro",
    emptyOutDir: false,
    copyPublicDir: false,
    rolldownOptions: {
      input: resolve(import.meta.dirname, "src/astro/styles.css"),
      output: {
        assetFileNames: ({ names }) =>
          names.some((name) => name.endsWith(".css"))
            ? "[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
