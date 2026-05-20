import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            The AI customer support platform for modern websites. Resolve faster, scale calmer.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link to="/features" className="hover:text-foreground text-muted-foreground">Features</Link></li>
            <li><Link to="/pricing" className="hover:text-foreground text-muted-foreground">Pricing</Link></li>
            <li><Link to="/customers" className="hover:text-foreground text-muted-foreground">Customers</Link></li>
            <li><Link to="/app" className="hover:text-foreground text-muted-foreground">Dashboard demo</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link to="/contact" className="hover:text-foreground text-muted-foreground">Contact</Link></li>
            <li><span className="text-muted-foreground">Privacy</span></li>
            <li><span className="text-muted-foreground">Terms</span></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} Helio AI, Inc. All rights reserved.</span>
          <span>SOC 2 Type II · GDPR · ISO 27001</span>
        </div>
      </div>
    </footer>
  );
}
