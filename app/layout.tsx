import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PatternProof — agree before the cut",
  description: "A visual approval workflow for made-to-order garments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
        <footer className="site-footer">
          <p>Private visual agreement for made-to-order garments.</p>
          <div><Link href="/proof">Evidence ledger</Link><Link href="/privacy">Privacy and image handling</Link></div>
        </footer>
      </body>
    </html>
  );
}
