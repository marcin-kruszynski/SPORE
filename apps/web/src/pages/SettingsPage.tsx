import { Lock, Settings2, ShieldCheck } from "lucide-react";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  MOCK_CATALOG_SOURCE,
  settingsPreviewSections,
} from "../mock/catalog.js";

const SettingsPage = () => {
  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Settings" subtitle="Mock-backed preview of future operator configuration surfaces" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner detail="Settings remain preview-only. This page intentionally summarizes seeded defaults instead of exposing unsupported save or reset affordances." />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Preview Sections" value={settingsPreviewSections.length} icon={<Settings2 className="h-4 w-4" />} />
            <SummaryCard label="Write Surfaces" value={0} icon={<Lock className="h-4 w-4" />} trend="Intentionally disabled" />
            <SummaryCard label="Policy Areas" value={3} icon={<ShieldCheck className="h-4 w-4" />} trend="Governance, validation, security" />
          </div>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {settingsPreviewSections.map((section) => (
              <article key={section.id} className="rounded-xl border border-border bg-card/60 p-5">
                <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
                <dl className="mt-4 space-y-3">
                  {section.entries.map((entry) => (
                    <div key={entry.label} className="rounded-lg border border-border bg-background/70 px-4 py-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.label}</dt>
                      <dd className="mt-1 text-sm text-foreground">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
