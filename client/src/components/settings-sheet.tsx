import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
    Monitor,
    Moon,
    Plug,
    Settings,
    Sun,
    XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstall } from "@/lib/install";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import InstallButton from "./install-button";
import McpDialog from "./mcp-dialog";

const THEME_OPTIONS: { key: Theme; label: string; Icon: typeof Sun }[] = [
    { key: "light", label: "Light", Icon: Sun },
    { key: "dark", label: "Dark", Icon: Moon },
    { key: "system", label: "System", Icon: Monitor },
];

function Section({
    title,
    description,
    children,
}: {
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="border-b border-border px-6 py-5 last:border-b-0">
            <h3 className="font-sans text-base font-semibold text-foreground">
                {title}
            </h3>
            {description && (
                <p className="mt-1 text-sm text-muted-foreground">
                    {description}
                </p>
            )}
            <div className="mt-3">{children}</div>
        </section>
    );
}

// Main's InstallButton (native prompt, or Safari's menu steps), shown only
// where installing is possible.
function InstallSection() {
    const { installed, canPrompt, manual } = useInstall();
    if (installed || (!canPrompt && !manual)) return null;
    return (
        <Section
            title="Install app"
            description="Open Gospel Help in its own window, with your saved passages and recent searches available offline."
        >
            <InstallButton />
        </Section>
    );
}

/**
 * The desktop's settings: an icon button that opens a panel from the right
 * (like Saved) holding the theme, the MCP connection, and, in a browser tab,
 * installing the app. Phones and the installed app use the app shell's
 * Settings tab instead.
 */
export default function SettingsSheet() {
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger
                aria-label="Settings"
                title="Settings"
                className="inline-flex select-none items-center rounded-md border border-input bg-card px-2 py-1.5 text-foreground transition-colors hover:border-primary"
            >
                <Settings className="h-4 w-4" />
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
                <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-background text-foreground shadow-[var(--shadow-popover)] outline-none duration-300 ease-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
                    <div className="flex flex-none items-start gap-3 border-b border-border px-6 pb-4 pt-5">
                        <DialogPrimitive.Title className="min-w-0 flex-1 font-display text-[28px] leading-tight text-foreground">
                            Settings
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="sr-only">
                            Theme, AI agents, and installing the app
                        </DialogPrimitive.Description>
                        <DialogPrimitive.Close
                            aria-label="Close"
                            className="-mr-2 flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            <XIcon className="h-5 w-5" />
                        </DialogPrimitive.Close>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        <Section title="Theme">
                            <div
                                role="radiogroup"
                                aria-label="Theme"
                                className="grid grid-cols-3 rounded-md border border-input bg-card p-0.5"
                            >
                                {THEME_OPTIONS.map(({ key, label, Icon }) => {
                                    const active = key === theme;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            onClick={() => setTheme(key)}
                                            className={cn(
                                                "inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors",
                                                active
                                                    ? "bg-primary font-semibold text-primary-foreground"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            <Icon className="h-4 w-4 flex-none" />
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </Section>

                        <Section
                            title="Use with AI agents"
                            description="Connect Claude or any MCP client so it can search the library as a tool."
                        >
                            <McpDialog
                                trigger={
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                    >
                                        <Plug className="h-4 w-4" />
                                        Set up MCP
                                    </Button>
                                }
                            />
                        </Section>

                        <InstallSection />
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
