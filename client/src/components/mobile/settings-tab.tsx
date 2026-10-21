import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
    BarChart3,
    ChevronRight,
    Monitor,
    Moon,
    Plug,
    SquarePlus,
    Sun,
    Trash2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { isStandalone } from "@/lib/use-is-mobile";
import McpDialog from "../mcp-dialog";
import Segmented from "./segmented";

interface SettingsTabProps {
    savedCount: number;
    onClearSaved: () => void;
}

const THEME_OPTIONS = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "Auto", Icon: Monitor },
] as const;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="mb-2 px-4 font-sans text-[13px] font-semibold text-muted-foreground">
                {label}
            </h2>
            <div className="overflow-hidden rounded-[22px] border border-border/70 bg-[var(--app-card)]">
                {children}
            </div>
        </section>
    );
}

const row =
    "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left text-[16px] text-foreground transition-colors active:bg-foreground/[0.06]";

export default function SettingsTab({
    savedCount,
    onClearSaved,
}: SettingsTabProps) {
    const { theme, setTheme } = useTheme();
    // Clearing every bookmark takes a second tap; the prompt times out.
    const [confirmingClear, setConfirmingClear] = useState(false);

    useEffect(() => {
        if (!confirmingClear) return;
        const timer = setTimeout(() => setConfirmingClear(false), 4000);
        return () => clearTimeout(timer);
    }, [confirmingClear]);

    return (
        <div className="px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <h1 className="font-display text-[34px] font-semibold leading-tight text-foreground">
                Settings
            </h1>

            <div className="mt-6 flex flex-col gap-7">
                <section>
                    <h2 className="mb-2 px-4 font-sans text-[13px] font-semibold text-muted-foreground">
                        Appearance
                    </h2>
                    <Segmented
                        label="Appearance"
                        value={theme}
                        onChange={setTheme}
                        options={THEME_OPTIONS}
                    />
                </section>

                <Group label="Explore">
                    <Link to="/stats" className={row}>
                        <BarChart3 className="h-5 w-5 flex-none text-primary" />
                        <span className="flex-1">
                            The library, by the numbers
                        </span>
                        <ChevronRight className="h-5 w-5 flex-none text-muted-foreground" />
                    </Link>
                    <div className="ml-12 h-px bg-border" />
                    <McpDialog
                        trigger={
                            <button type="button" className={row}>
                                <Plug className="h-5 w-5 flex-none text-primary" />
                                <span className="flex-1">
                                    Use with AI agents
                                </span>
                                <ChevronRight className="h-5 w-5 flex-none text-muted-foreground" />
                            </button>
                        }
                    />
                </Group>

                {savedCount > 0 && (
                    <Group label="Saved passages">
                        <button
                            type="button"
                            onClick={() => {
                                if (!confirmingClear) {
                                    setConfirmingClear(true);
                                    return;
                                }
                                setConfirmingClear(false);
                                onClearSaved();
                            }}
                            className={`${row} text-destructive`}
                        >
                            <Trash2 className="h-5 w-5 flex-none" />
                            <span className="flex-1">
                                {confirmingClear
                                    ? `Tap again to remove all ${savedCount}`
                                    : "Clear saved passages"}
                            </span>
                        </button>
                    </Group>
                )}

                {!isStandalone() && (
                    <div className="flex items-start gap-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5">
                        <SquarePlus className="mt-0.5 h-5 w-5 flex-none text-primary" />
                        <p className="text-[15px] leading-snug text-muted-foreground">
                            <span className="font-semibold text-foreground">
                                Add to Home Screen
                            </span>{" "}
                            from your browser’s share menu to open Gospel Help
                            full-screen, like an app.
                        </p>
                    </div>
                )}

                <p className="px-4 text-center text-[13px] leading-relaxed text-muted-foreground">
                    &copy; {new Date().getFullYear()} Gospel Help
                    <br />
                    Not affiliated with any religious organization.
                </p>
            </div>
        </div>
    );
}
