import { Bot, FolderKanban, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  catalogTeams,
  getAgentsForTeam,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";

const TeamsPage = () => {
  const totalAgents = catalogTeams.reduce((count, team) => count + getAgentsForTeam(team.id).length, 0);
  const linkedProjects = catalogTeams.reduce((count, team) => count + team.projectIds.length, 0);

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Teams" subtitle="Mock-backed catalog preview for reusable agent groups" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Catalog Teams" value={catalogTeams.length} icon={<Users className="h-4 w-4" />} />
            <SummaryCard label="Assigned Agents" value={totalAgents} icon={<Bot className="h-4 w-4" />} />
            <SummaryCard label="Linked Projects" value={linkedProjects} icon={<FolderKanban className="h-4 w-4" />} />
          </div>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {catalogTeams.map((team) => {
              const teamAgents = getAgentsForTeam(team.id);

              return (
                <Link
                  key={team.id}
                  to={`/teams/${team.id}`}
                  className="rounded-xl border border-border bg-card/60 p-5 transition-colors hover:border-primary/30 hover:bg-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Users className="h-4 w-4" />
                    </div>
                    <StatusBadge status={team.status} />
                  </div>
                  <h2 className="mt-4 text-sm font-semibold text-foreground">{team.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{team.purpose}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{teamAgents.length} agent{teamAgents.length === 1 ? "" : "s"}</span>
                    <span>{team.projectIds.length} project{team.projectIds.length === 1 ? "" : "s"}</span>
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

export default TeamsPage;
