export default function Footer() {
    return (
        <footer className="text-center p-4 text-slate-500 text-sm">
            &copy; {new Date().getFullYear()}{" "}
            <a
                href="https://ethanglenn.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-900 font-semibold"
            >
                Ethan Glenn
            </a>
            . All rights reserved.{" "}
            <a
                href="https://github.com/eglenn-dev/bible-search"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-900 font-semibold"
            >
                GitHub
            </a>
            .
        </footer>
    );
}
