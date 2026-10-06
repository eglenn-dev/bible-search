import { Sparkles } from "lucide-react";

interface ConferenceBannerProps {
    // Narrows the search to General Conference so the new talks are one
    // click away.
    onSelect: () => void;
}

// Announces the most recent General Conference ingest. Update the label (or
// remove the banner) after the next conference is synced.
export default function ConferenceBanner({ onSelect }: ConferenceBannerProps) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className="mb-6 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-accent px-4 py-1.5 text-center text-sm text-accent-foreground transition-colors hover:border-primary"
        >
            <Sparkles className="h-4 w-4 flex-none text-primary" />
            <span>
                <span className="font-semibold">New:</span> October 2026
                General Conference talks are now searchable
            </span>
        </button>
    );
}
