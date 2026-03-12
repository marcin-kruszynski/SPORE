import type { ReactNode } from "react";
import { Search, Bell, Inbox } from "lucide-react";

import { Button } from "../ui/button.js";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
  pendingCount?: number;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, pendingCount = 3 }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {breadcrumbs && (
          <nav className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-border">/</span>}
                <span className={i === breadcrumbs.length - 1 ? "text-foreground" : ""}>{b.label}</span>
              </span>
            ))}
          </nav>
        )}
        {!breadcrumbs && (
          <div>
            <h1 className="text-sm font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
          <Search className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
          <Inbox className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
          OP
        </div>
      </div>
    </header>
  );
}
