import { useState } from "react";
import { Plug, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

const TOOLS = ["search", "search_by_reference", "get_verse", "health"];

export default function McpDialog() {
    const [copied, setCopied] = useState(false);
    const apiDomain = import.meta.env.VITE_API_DOMAIN ?? "";
    const mcpUrl = `${apiDomain}/mcp`;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(mcpUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard may be unavailable (e.g. non-secure context); ignore
        }
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full gap-2">
                    <Plug className="h-4 w-4" />
                    Use with AI agents
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="font-display text-xl">
                        Use with AI agents (MCP)
                    </DialogTitle>
                    <DialogDescription>
                        This service is a remote{" "}
                        <a
                            href="https://modelcontextprotocol.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            MCP
                        </a>{" "}
                        server. Add the URL to any MCP-capable agent and it can
                        search the scriptures as tools — no install required.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 text-sm">
                    <div>
                        <p className="mb-1.5 font-medium text-foreground">
                            Server URL
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 truncate rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-xs">
                                {mcpUrl}
                            </code>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={copy}
                                aria-label="Copy server URL"
                            >
                                {copied ? (
                                    <Check className="h-4 w-4 text-primary" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </div>

                    <div>
                        <p className="mb-1.5 font-medium text-foreground">
                            Add to Claude
                        </p>
                        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                            <li>
                                Open Settings →{" "}
                                <span className="text-foreground">
                                    Connectors
                                </span>
                            </li>
                            <li>
                                Click{" "}
                                <span className="text-foreground">
                                    Add custom connector
                                </span>
                            </li>
                            <li>Paste the URL above and connect</li>
                        </ol>
                    </div>

                    <div>
                        <p className="mb-1.5 font-medium text-foreground">
                            Other platforms
                        </p>
                        <p className="mb-2 text-muted-foreground">
                            Any client that supports remote MCP (Streamable
                            HTTP):
                        </p>
                        <pre className="overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs text-foreground">
                            {`{
  "mcpServers": {
    "gospel-library-search": {
      "url": "${mcpUrl}"
    }
  }
}`}
                        </pre>
                    </div>

                    <div>
                        <p className="mb-1.5 font-medium text-foreground">
                            Available tools
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {TOOLS.map((tool) => (
                                <span
                                    key={tool}
                                    className="rounded-full bg-secondary px-2.5 py-0.5 font-mono text-xs text-secondary-foreground"
                                >
                                    {tool}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
