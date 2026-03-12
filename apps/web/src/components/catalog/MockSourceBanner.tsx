import { FlaskConical, Lock } from "lucide-react";

import {
  MOCK_CATALOG_NOTICE,
  MOCK_CATALOG_READ_ONLY_COPY,
  MOCK_CATALOG_SOURCE,
} from "../../mock/catalog.js";

interface MockSourceBannerProps {
  title?: string;
  detail?: string;
}

export function MockSourceBanner({
  title = "Preview only",
  detail = MOCK_CATALOG_NOTICE,
}: MockSourceBannerProps) {
  return (
    <section
      className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4"
      data-read-only="true"
      data-source={MOCK_CATALOG_SOURCE}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 self-start rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Lock className="h-3 w-3" /> {MOCK_CATALOG_READ_ONLY_COPY}
        </div>
      </div>
    </section>
  );
}
