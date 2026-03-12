import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  catalogAgents,
  getTeamsForAgent,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";

const AgentsPage = () => {
  const activeAgents = catalogAgents.filter((agent) => agent.status === "active").length;
  const guardedAgents = catalogAgents.filter((agent) => agent.guardrails.length > 0).length;

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Agents" subtitle="Mock-backed catalog preview for agent roles and capabilities" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <SummaryCard label="Catalog Agents" value={catalogAgents.length} icon={<Bot className="h-4 w-4" />} />
            <SummaryCard label="Active Agents" value={activeAgents} icon={<Sparkles className="h-4 w-4" />} />
            <SummaryCard label="Guardrailed" value={guardedAgents} icon={<ShieldCheck className="h-4 w-4" />} />
            <SummaryCard label="Tool Profiles" value={catalogAgents.reduce((count, agent) => count + agent.toolIds.length, 0)} icon={<Wrench className="h-4 w-4" />} />
          </div>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {catalogAgents.map((agent) => {
              const teams = getTeamsForAgent(agent.id);

              return (
                <Link
                  key={agent.id}
                  to={`/agents/${agent.id}`}
                  className="rounded-xl border border-border bg-card/60 p-5 transition-colors hover:border-primary/30 hover:bg-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" />
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                  <h2 className="mt-4 text-sm font-semibold text-foreground">{agent.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{agent.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{agent.skillIds.length} skill{agent.skillIds.length === 1 ? "" : "s"}</span>
                    <span>{agent.toolIds.length} tool{agent.toolIds.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {teams.map((team) => (
                      <span key={team.id} className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {team.name}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AgentsPage;
