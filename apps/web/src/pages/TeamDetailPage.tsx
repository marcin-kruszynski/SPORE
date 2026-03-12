import { ArrowLeft, Bot, FolderKanban, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Button } from "../components/ui/button.js";
import {
  getAgentsForTeam,
  getLiveProjectHref,
  getProjectsForTeam,
  getCatalogTeam,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";
import NotFound from "./NotFound.js";

const TeamDetailPage = () => {
  const { id = "" } = useParams();
  const team = getCatalogTeam(id);

  if (!team) {
    return <NotFound />;
  }

  const teamAgents = getAgentsForTeam(team.id);
  const teamProjects = getProjectsForTeam(team.id);

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader
        title={team.name}
        breadcrumbs={[{ label: "Teams", href: "/teams" }, { label: team.name }]}
        pendingCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <MockSourceBanner detail="Team detail stays on seeded catalog data. Linked agents remain mock-backed, and linked projects without a current derived route stay read-only." />

          <section className="rounded-xl border border-border bg-card/60 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold text-foreground">{team.name}</h1>
                    <p className="text-sm text-muted-foreground">{team.purpose}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge status={team.status} size="md" />
                <Link to="/teams">
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 text-xs">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to teams
                  </Button>
                </Link>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-border bg-card/60 p-5">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Assigned agents</h2>
              </div>
              <div className="space-y-2">
                {teamAgents.map((agent) => (
                  <Link
                    key={agent.id}
                    to={`/agents/${agent.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-3 transition-colors hover:border-primary/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.description}</p>
                    </div>
                    <StatusBadge status={agent.status} />
                  </Link>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card/60 p-5">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Linked projects</h2>
              </div>
              <div className="space-y-2">
                {teamProjects.map((project) => {
                  const liveProjectHref = getLiveProjectHref(project);
                  const content = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{project.name}</p>
                        <p className="text-xs text-muted-foreground">{project.spaceName}</p>
                      </div>
                      <StatusBadge status={project.status} />
                    </>
                  );

                  return liveProjectHref ? (
                    <Link
                      key={project.id}
                      to={liveProjectHref}
                      className="flex items-center gap-3 rounded-lg border border-border bg-background/70 p-3 transition-colors hover:border-primary/30"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      key={project.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamDetailPage;
