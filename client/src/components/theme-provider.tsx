import { useCallback, useEffect, useMemo, useState } from "react";
import {
    applyResolvedTheme,
    readStoredTheme,
    resolveTheme,
    ThemeContext,
    watchSystemTheme,
    writeStoredTheme,
    type Theme,
} from "@/lib/theme";

/**
 * Owns the theme setting and keeps the <html> class in sync with it.
 *
 * The class is already correct on first paint (see the pre-paint script in
 * index.html), so the effects here are about *changes*: the user picking a new
 * setting, or the OS flipping while "system" is selected.
 */
export default function ThemeProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [theme, setThemeState] = useState<Theme>(readStoredTheme);
    const [resolvedTheme, setResolvedTheme] = useState(() =>
        resolveTheme(readStoredTheme()),
    );

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next);
        writeStoredTheme(next);
        const resolved = resolveTheme(next);
        setResolvedTheme(resolved);
        applyResolvedTheme(resolved);
    }, []);

    // Re-assert on mount so the DOM matches even if the pre-paint script was
    // blocked, and follow the OS while "system" is selected.
    useEffect(() => {
        applyResolvedTheme(resolveTheme(theme));
        if (theme !== "system") return;
        return watchSystemTheme((resolved) => {
            setResolvedTheme(resolved);
            applyResolvedTheme(resolved);
        });
    }, [theme]);

    const value = useMemo(
        () => ({ theme, resolvedTheme, setTheme }),
        [theme, resolvedTheme, setTheme],
    );

    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
}
