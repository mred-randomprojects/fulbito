import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : "/fulbito/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React changes far less often than the app does, so keeping it in its
        // own chunk lets it stay cached across deploys.
        manualChunks: { react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
}));
