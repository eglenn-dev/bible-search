// Theme plumbing shared by the provider, the toggle, and the pre-paint script
// in index.html. Three settings — light, dark, and system (the default) —
// where "system" tracks the OS `prefers-color-scheme` and keeps tracking it
// as the user flips their OS setting.
//
// The rendered theme is expressed as a single `dark` class on <html>, which is
// what the `dark` variant in index.css keys off. `color-scheme` rides along in
// the CSS so form controls, scrollbars, and the like match.

import { createContext, useContext } from "react";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

// Keep in sync with the pre-paint script in index.html.
export const THEME_STORAGE_KEY = "gs-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
    return THEMES.includes(value as Theme);
}

/** The saved preference, or "system" when absent or unreadable. */
export function readStoredTheme(): Theme {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (isTheme(stored)) return stored;
    } catch {
        // Private mode / disabled storage — fall back to the default.
    }
    return DEFAULT_THEME;
}

export function writeStoredTheme(theme: Theme): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Non-fatal: the theme still applies for this page view.
    }
}

export function prefersDark(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia(DARK_QUERY).matches
    );
}

/** Turns the setting into the theme actually painted. */
export function resolveTheme(theme: Theme): ResolvedTheme {
    if (theme === "system") return prefersDark() ? "dark" : "light";
    return theme;
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
    document.documentElement.classList.toggle("dark", resolved === "dark");
}

/** Calls back whenever the OS preference flips. Returns an unsubscribe fn. */
export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void) {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return () => {};
    const mql = window.matchMedia(DARK_QUERY);
    const handler = (e: MediaQueryListEvent) =>
        onChange(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
}

export interface ThemeContextValue {
    /** What the user picked: light, dark, or system. */
    theme: Theme;
    /** What that currently paints as. */
    resolvedTheme: ResolvedTheme;
    setTheme: (next: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
    return ctx;
}
