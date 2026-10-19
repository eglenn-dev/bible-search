import { useState } from "react";
import { MonitorDown } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { promptInstall, useInstall, type ManualInstall } from "@/lib/install";

/** Where the browser keeps its own "install" command. */
// eslint-disable-next-line react-refresh/only-export-components
export const MANUAL_STEPS: Record<ManualInstall, React.ReactNode> = {
    ios: (
        <>
            Tap <span className="font-semibold text-foreground">Share</span>,
            then{" "}
            <span className="font-semibold text-foreground">
                Add to Home Screen
            </span>
            .
        </>
    ),
    "mac-safari": (
        <>
            Choose{" "}
            <span className="font-semibold text-foreground">
                File › Add to Dock
            </span>{" "}
            from Safari’s menu bar.
        </>
    ),
};

/**
 * The desktop layout's "Install app" button. Only rendered when installing
 * is possible here: the native dialog (Chrome, Edge) or Safari's menu.
 */
export default function InstallButton() {
    const { installed, canPrompt, manual } = useInstall();
    const [helpOpen, setHelpOpen] = useState(false);

    if (installed || (!canPrompt && !manual)) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    if (canPrompt) void promptInstall();
                    else setHelpOpen(true);
                }}
                title="Install Gospel Help as an app"
                className="inline-flex select-none items-center gap-2 rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground transition-colors hover:border-primary"
            >
                <MonitorDown className="h-4 w-4" aria-hidden="true" />
                Install app
            </button>
            {manual && (
                <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-semibold">
                                Install Gospel Help
                            </DialogTitle>
                            <DialogDescription>
                                Installed, Gospel Help opens in its own window
                                with the app layout, and keeps your saved
                                passages and recent searches available offline.
                            </DialogDescription>
                        </DialogHeader>
                        <p className="text-sm text-muted-foreground">
                            {MANUAL_STEPS[manual]}
                        </p>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
