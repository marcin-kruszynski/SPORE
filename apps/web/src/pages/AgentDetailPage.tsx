import { ArrowLeft, Bot, ShieldCheck, Sparkles, Users, Wrench } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Button } from "../components/ui/button.js";
import {
  getCatalogAgent,
  getSkillsForAgent,
  getTeamsForAgent,
  getToolsForAgent,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";
import NotFound from "./NotFound.js";

const riskTone: Record<string, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  critical: "bg-destructive/15 text-destructive",
};

function StaticDetailCard(props: {
  eyebrow: string;
  title: string;
  description: string;
  trailing?: string;
  trailingClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{props.eyebrow}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{props.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{props.description}</p>
        </div>
        {props.trailing ? (
          <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${props.trailingClassName ?? "bg-muted text-muted-foreground"}`}>
            {props.trailing}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const AgentDetailPage = () => {
  const { id = "" } = useParams();
  const agent = getCatalogAgent(id);

  if (!agent) {
    return <NotFound />;
  }

  const agentSkills = getSkillsForAgent(agent.id);
  const agentTools = getToolsForAgent(agent.id);
  const agentTeams = getTeamsForAgent(agent.id);

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader
        title={agent.name}
        breadcrumbs={[{ label: "Agents", href: "/agents" }, { label: agent.name }]}
        pendingCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <MockSourceBanner detail="Agent detail is intentionally mock-backed. Skill and tool detail links stay disabled until dedicated detail routes exist." />

          <section className="rounded-xl border border-border bg-card/60 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">{agent.name}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge status={agent.status} size="md" />
                <Link to="/agents">
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 text-xs">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to agents
                  </Button>
                </Link>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section className="space-y-3 rounded-xl border border-border bg-card/60 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Skills</h2>
              </div>
              <div className="space-y-2">
                {agentSkills.map((skill) => (
                  <StaticDetailCard
                    key={skill.id}
                    eyebrow={skill.category}
                    title={skill.name}
                    description={skill.description}
                    trailing="No detail route"
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card/60 p-5">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Tools</h2>
              </div>
              <div className="space-y-2">
                {agentTools.map((tool) => (
                  <StaticDetailCard
                    key={tool.id}
                    eyebrow="Tool capability"
                    title={tool.name}
                    description={tool.description}
                    trailing={tool.riskLevel}
                    trailingClassName={riskTone[tool.riskLevel]}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-5 rounded-xl border border-border bg-card/60 p-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Teams</h2>
                </div>
                <div className="space-y-2">
                  {agentTeams.map((team) => (
                    <Link
                      key={team.id}
                      to={`/teams/${team.id}`}
                      className="block rounded-lg border border-border bg-background/70 p-3 transition-colors hover:border-primary/30"
                    >
                      <p className="text-sm font-medium text-foreground">{team.name}</p>
                      <p className="text-xs text-muted-foreground">{team.purpose}</p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Guardrails</h2>
                </div>
                <div className="space-y-2">
                  {agent.guardrails.map((guardrail) => (
                    <div key={guardrail} className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      {guardrail}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentDetailPage;
