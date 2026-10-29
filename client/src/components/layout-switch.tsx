import { MessageCircleQuestionMark } from "lucide-react";
import { useQueryState } from "nuqs";
import { setLayout } from "@/lib/use-is-mobile";

/**
 * The classic home page's way into the app layout, which is the only place
 * Ask lives: switches this browser (remembered) and opens on the Ask tab.
 * Settings has the same switch, and the app's Settings tab switches back.
 */
export default function TryAppButton() {
    const [, setTab] = useQueryState("tab");
    return (
        <button
            type="button"
            onClick={() => {
                void setTab("ask");
                setLayout("app");
            }}
            title="Switch to the app layout, with Ask"
            className="inline-flex select-none items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary"
        >
            <MessageCircleQuestionMark
                className="h-4 w-4 text-primary"
                aria-hidden="true"
            />
            Try Ask in the new app
        </button>
    );
}
