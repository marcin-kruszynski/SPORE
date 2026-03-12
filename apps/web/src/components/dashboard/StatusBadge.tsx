import { cn } from "../../lib/utils.js";

const statusConfig: Record<string, { label: string; className: string }> = {
  "active": { label: "Active", className: "bg-success/15 text-success border-success/30" },
  "inactive": { label: "Inactive", className: "bg-muted text-muted-foreground border-border" },
  "running": { label: "Running", className: "bg-info/15 text-info border-info/30 animate-pulse-soft" },
  "completed": { label: "Completed", className: "bg-success/15 text-success border-success/30" },
  "needs-review": { label: "Needs Review", className: "bg-warning/15 text-warning border-warning/30" },
  "needs-approval": { label: "Needs Approval", className: "bg-warning/15 text-warning border-warning/30" },
  "held": { label: "Held", className: "bg-muted text-muted-foreground border-border" },
  "blocked": { label: "Blocked", className: "bg-destructive/15 text-destructive border-destructive/30" },
  "rejected": { label: "Rejected", className: "bg-destructive/15 text-destructive border-destructive/30" },
  "validation-pending": { label: "Validation Pending", className: "bg-info/15 text-info border-info/30" },
  "promotion-ready": { label: "Promotion Ready", className: "bg-primary/15 text-primary border-primary/30" },
  "promotion-blocked": { label: "Promotion Blocked", className: "bg-destructive/15 text-destructive border-destructive/30" },
  "quarantined": { label: "Quarantined", className: "bg-destructive/15 text-destructive border-destructive/30" },
  "planned": { label: "Planned", className: "bg-info/15 text-info border-info/30" },
  "reviewed": { label: "Reviewed", className: "bg-success/15 text-success border-success/30" },
  "materialized": { label: "Materialized", className: "bg-primary/15 text-primary border-primary/30" },
  "draft": { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  "ready_for_review": { label: "Ready For Review", className: "bg-warning/15 text-warning border-warning/30" },
  "validation_required": { label: "Validation Required", className: "bg-info/15 text-info border-info/30" },
  "validation_failed": { label: "Validation Failed", className: "bg-destructive/15 text-destructive border-destructive/30" },
  "promotion_ready": { label: "Promotion Ready", className: "bg-primary/15 text-primary border-primary/30" },
  "promotion_candidate": { label: "Promotion Candidate", className: "bg-primary/15 text-primary border-primary/30" },
  "pending": { label: "Pending", className: "bg-warning/15 text-warning border-warning/30" },
  "resolved": { label: "Resolved", className: "bg-success/15 text-success border-success/30" },
  "superseded": { label: "Superseded", className: "bg-muted text-muted-foreground border-border" },
};

function humanizeStatus(status: string) {
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  className?: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, className, size = "sm" }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: humanizeStatus(status || "inactive"),
    className: statusConfig["inactive"].className,
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border font-medium",
      size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
      config.className,
      className,
    )}>
      {config.label}
    </span>
  );
}
