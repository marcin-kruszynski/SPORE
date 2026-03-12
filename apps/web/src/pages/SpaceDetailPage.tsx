import { ArrowLeft, FolderKanban, Layers } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Button } from "../components/ui/button.js";
import {
  getCatalogSpace,
  getLiveProjectHref,
  getProjectsForSpace,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";
import NotFound from "./NotFound.js";

const SpaceDetailPage = () => {
  const { id = "" } = useParams();
  const space = getCatalogSpace(id);

  if (!space) {
    return <NotFound />;
  }

  const spaceProjects = getProjectsForSpace(space.id);

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader
        title={space.name}
        breadcrumbs={[{ label: "Spaces", href: "/spaces" }, { label: space.name }]}
        pendingCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <MockSourceBanner detail="Space detail is seeded from mock catalog data. Linked seeded projects open the live-backed project route only when a derived match exists." />

          <section className="rounded-xl border border-border bg-card/60 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold text-foreground">{space.name}</h1>
                    <p className="text-sm text-muted-foreground">{space.description}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge status={space.status} size="md" />
                <Link to="/spaces">
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 text-xs">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to spaces
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-background/70 p-4">
                <p className="text-xs font-medium uppercase tracking-wide">Linked projects</p>
                <p className="mt-2 text-foreground">{spaceProjects.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-4">
                <p className="text-xs font-medium uppercase tracking-wide">Last catalog activity</p>
                <p className="mt-2 text-foreground">{space.lastActivity}</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Projects in this space</h2>
              <p className="text-sm text-muted-foreground">These links jump into the real-backed project routes already wired in the dashboard.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {spaceProjects.map((project) => {
                const liveProjectHref = getLiveProjectHref(project);
                const content = (
                  <>
                    <FolderKanban className="h-4 w-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
                      <p className="text-xs text-muted-foreground">{project.description}</p>
                    </div>
                    <StatusBadge status={project.status} />
                  </>
                );

                return liveProjectHref ? (
                  <Link
                    key={project.id}
                    to={liveProjectHref}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-card"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={project.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-4"
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
  );
};

export default SpaceDetailPage;
