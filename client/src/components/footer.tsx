export default function Footer() {
    return (
        <footer className="text-center p-6 text-muted-foreground text-sm border-t border-border/60 mt-8">
            &copy; {new Date().getFullYear()}{" "}
            <a
                href="https://ethanglenn.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary font-semibold"
            >
                Ethan Glenn
            </a>
            . All rights reserved.{" "}
            <a
                href="https://github.com/eglenn-dev/bible-search"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary font-semibold"
            >
                GitHub
            </a>
            .
        </footer>
    );
}
