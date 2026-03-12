import { FolderKanban, Layers } from "lucide-react";
import { Link } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  catalogProjects,
  catalogSpaces,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";

const SpacesPage = () => {
  const activeSpaces = catalogSpaces.filter((space) => space.status === "active").length;
  const activeProjects = catalogProjects.filter((project) => project.status !== "inactive").length;

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Spaces" subtitle="Mock-backed catalog preview for top-level delivery domains" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Catalog Spaces" value={catalogSpaces.length} icon={<Layers className="h-4 w-4" />} />
            <SummaryCard label="Active Spaces" value={activeSpaces} />
            <SummaryCard label="Linked Projects" value={activeProjects} icon={<FolderKanban className="h-4 w-4" />} />
          </div>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {catalogSpaces.map((space) => (
              <Link
                key={space.id}
                to={`/spaces/${space.id}`}
                className="rounded-xl border border-border bg-card/60 p-5 transition-colors hover:border-primary/30 hover:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="h-4 w-4" />
                  </div>
                  <StatusBadge status={space.status} />
                </div>
                <h2 className="mt-4 text-sm font-semibold text-foreground">{space.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{space.description}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{space.projectCount} project{space.projectCount === 1 ? "" : "s"}</span>
                  <span>{space.lastActivity}</span>
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SpacesPage;
