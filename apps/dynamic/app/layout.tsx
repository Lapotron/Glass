import type { ReactNode } from 'react';
import './style.css';
export const metadata = {
  title: 'Glass · Dynamic prototype',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <div className="prototype-shell">
          <header className="glass-panel prototype-header">
            <a href="/" className="prototype-brand">
              Glass<span>Private dynamic prototype</span>
            </a>
            <nav aria-label="Prototype navigation">
              <a href="/">Overview</a>
              <a href="/admin/">Admin notes</a>
              <a href="/published/">Published snapshot</a>
            </nav>
            <a className="text-link" href="https://example.com/" target="_blank" rel="noreferrer">
              Production ↗
            </a>
          </header>
          <main>{children}</main>
          <footer>Isolated Vinext + Workers + D1 · Production remains on Cloudflare Pages.</footer>
        </div>
      </body>
    </html>
  );
}
