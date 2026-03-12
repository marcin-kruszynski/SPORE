import { Link } from "react-router-dom";
import { Bot, ShieldAlert, Wrench } from "lucide-react";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  catalogTools,
  getAgentsForTool,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";

const riskColors: Record<string, string> = {
  low: "bg-success/15 text-success border-success/30",
  medium: "bg-info/15 text-info border-info/30",
  high: "bg-warning/15 text-warning border-warning/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

const ToolsPage = () => {
  const criticalTools = catalogTools.filter((tool) => tool.riskLevel === "critical").length;
  const linkedAgents = catalogTools.reduce((count, tool) => count + getAgentsForTool(tool.id).length, 0);

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Tools" subtitle="Mock-backed catalog preview of executable capabilities" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner detail="Tool detail routes are not implemented yet, so this surface stays list-only and read-only." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Catalog Tools" value={catalogTools.length} icon={<Wrench className="h-4 w-4" />} />
            <SummaryCard label="Critical Risk Tools" value={criticalTools} icon={<ShieldAlert className="h-4 w-4" />} />
            <SummaryCard label="Agent Assignments" value={linkedAgents} icon={<Bot className="h-4 w-4" />} />
          </div>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {catalogTools.map((tool) => {
              const linkedAgentsForTool = getAgentsForTool(tool.id);

              return (
                <article key={tool.id} className="rounded-xl border border-border bg-card/60 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Wrench className="h-4 w-4" />
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${riskColors[tool.riskLevel]}`}>
                      {tool.riskLevel}
                    </span>
                  </div>
                  <h2 className="mt-4 text-sm font-semibold text-foreground">{tool.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{tool.description}</p>

                  <div className="mt-4 space-y-2">
                    {tool.restrictions.map((restriction) => (
                      <div key={restriction} className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                        {restriction}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {linkedAgentsForTool.map((agent) => (
                      <Link
                        key={agent.id}
                        to={`/agents/${agent.id}`}
                        className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                      >
                        {agent.name}
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ToolsPage;
