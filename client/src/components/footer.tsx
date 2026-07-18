export default function Footer() {
    return (
        <footer className="mt-8 border-t border-border/60 p-6 text-center text-[15px] text-muted-foreground">
            &copy; {new Date().getFullYear()}{" "}
            <a
                href="https://ethanglenn.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground/80 underline-offset-[3px] hover:text-primary hover:underline"
            >
                Ethan Glenn
            </a>
            | Not affiliated with any religious organization.
        </footer>
    );
}
