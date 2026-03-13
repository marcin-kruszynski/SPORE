import { ExternalLink, TerminalSquare } from "lucide-react";

import { StatusBadge } from "../dashboard/StatusBadge.js";
import type { AgentSessionDetailViewModel } from "../../types/agent-cockpit.js";

interface AgentSessionSummaryProps {
  detail: AgentSessionDetailViewModel;
}

function DetailRow(props: { label: string; value: string | null }) {
  if (!props.value) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function ContentPanel(props: {
  eyebrow: string;
  title: string;
  content: string | null;
  footer?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-background/60 p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{props.eyebrow}</p>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{props.title}</h3>
      {props.content ? (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-card/70 p-4 font-mono text-xs text-foreground">
          {props.content}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No content is available yet.</p>
      )}
      {props.footer && <p className="mt-3 text-xs text-muted-foreground">{props.footer}</p>}
    </section>
  );
}

export function AgentSessionSummary({ detail }: AgentSessionSummaryProps) {
  const requestFooter = [
    detail.requestPrompt.source ? `Source: ${detail.requestPrompt.source}` : null,
    detail.requestPrompt.expectedKind
      ? `Expected return: ${detail.requestPrompt.expectedKind}`
      : null,
  ]
    .filter(Boolean)
    .join(" - ");

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current lane</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{detail.label}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.state} size="md" />
            {detail.stageLabel && <span className="text-sm text-foreground">{detail.stageLabel}</span>}
            <span className="text-xs text-muted-foreground">{detail.freshnessLabel}</span>
          </div>
          <p className="mt-3 text-sm text-foreground">
            {detail.latestSummary ?? detail.summary ?? "No visible lane summary yet."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/70 p-4 lg:max-w-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Session health</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{detail.sessionHealth.label}</p>
          <p className="mt-2 text-sm text-muted-foreground">{detail.sessionHealth.message}</p>
          {detail.sessionHref && (
            <a
              href={detail.sessionHref}
              className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              aria-label="Open live session payload"
            >
              Open live session payload
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        <ContentPanel
          eyebrow="Input"
          title={detail.requestPrompt.title}
          content={detail.requestPrompt.content}
          footer={requestFooter || null}
        />
        <ContentPanel
          eyebrow="Live output"
          title="Latest visible session output"
          content={detail.transcriptPreview.content}
          footer={detail.transcriptPreview.path ?? detail.inspection.transcriptPath}
        />
        <ContentPanel
          eyebrow="Returned output"
          title={detail.returnedHandoff.title}
          content={detail.returnedHandoff.content}
          footer={
            detail.returnedHandoff.valid === null
              ? null
              : detail.returnedHandoff.valid
                ? "Structured handoff is valid."
                : `Structured handoff is invalid.${detail.returnedHandoff.issues.length ? ` ${detail.returnedHandoff.issues[0]}` : ""}`
          }
        />
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Mission linkage</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {detail.mission.title ?? "Mission linkage unavailable"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{detail.mission.summary}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Execution linkage</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {detail.execution.id ?? "Execution linkage unavailable"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{detail.execution.summary}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <TerminalSquare className="h-3.5 w-3.5" />
          Session inspection entrypoints
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DetailRow label="Session id" value={detail.sessionId} />
          <DetailRow label="Tmux session" value={detail.inspection.tmuxSession} />
          <DetailRow label="Workspace" value={detail.inspection.workspaceId} />
          <DetailRow label="Workspace purpose" value={detail.inspection.workspacePurpose} />
          <DetailRow label="Branch" value={detail.inspection.branchName} />
          <DetailRow label="Cwd" value={detail.inspection.cwd} />
          <DetailRow label="Runtime" value={detail.inspection.runtimeAdapter} />
          <DetailRow label="Transport" value={detail.inspection.transportMode} />
          <DetailRow label="Launcher" value={detail.inspection.launcherType} />
          <DetailRow label="Last event" value={detail.inspection.lastEventType} />
        </div>
      </div>
    </section>
  );
}
