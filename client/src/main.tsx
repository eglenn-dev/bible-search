import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import "./index.css";
import App from "./App.tsx";
import StatsPage from "./pages/stats.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <NuqsAdapter>
                <Routes>
                    <Route path="/stats" element={<StatsPage />} />
                    <Route path="*" element={<App />} />
                </Routes>
            </NuqsAdapter>
        </BrowserRouter>
    </StrictMode>
);
