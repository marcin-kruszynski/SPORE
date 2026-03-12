import { Compass, Home } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-12" data-route-state="not-found">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card/70 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Compass className="h-5 w-5" />
        </div>
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          No dashboard route is wired for <span className="font-mono text-foreground">{location.pathname}</span>.
        </p>
        <div className="mt-6 flex justify-center">
          <Link to="/" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/30 hover:text-primary">
            <Home className="h-4 w-4" /> Return to mission control
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
