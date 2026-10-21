import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// https://tanstack.com/start/latest/docs/framework/react/guide/hosting
// Nitro builds the server for whichever host it detects: a Vercel Function
// (Build Output API) on Vercel, a plain Node server (`npm start`) elsewhere.
export default defineConfig({
    plugins: [tanstackStart(), nitro(), react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
        },
    },
});
