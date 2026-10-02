import { Link } from "react-router-dom";

export default function Footer() {
    return (
        <footer className="mt-8 border-t border-border bg-muted p-6 text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Gospel Help</p>
            <p>Not affiliated with any religious organization.</p>
            <p className="mt-1">
                <Link
                    to="/stats"
                    className="text-primary underline hover:text-primary-strong"
                >
                    The library, by the numbers
                </Link>
            </p>
        </footer>
    );
}
