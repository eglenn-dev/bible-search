import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import "./index.css";
// Before anything renders: catches the install prompt however early it fires.
import "./lib/install";
import App from "./App.tsx";
import StatsPage from "./pages/stats.tsx";
import ThemeProvider from "./components/theme-provider.tsx";
import UpdateToast from "./components/update-toast.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <BrowserRouter>
                <NuqsAdapter>
                    <Routes>
                        <Route path="/stats" element={<StatsPage />} />
                        <Route path="*" element={<App />} />
                    </Routes>
                </NuqsAdapter>
            </BrowserRouter>
            <UpdateToast />
        </ThemeProvider>
    </StrictMode>
);
