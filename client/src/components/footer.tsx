export default function Footer() {
    return (
        <footer className="mt-8 border-t border-border/60 p-6 text-center text-[15px] text-muted-foreground">
            &copy; {new Date().getFullYear()} | Not affiliated with any
            religious organization.
        </footer>
    );
}
