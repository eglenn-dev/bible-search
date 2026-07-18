export default function Footer() {
    return (
        <footer className="mt-8 border-t border-border/60 p-6 text-center text-[15px] text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Gospel Help</p>
            <p>Not affiliated with any religious organization.</p>
        </footer>
    );
}
