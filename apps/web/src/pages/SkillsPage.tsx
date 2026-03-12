import { Link } from "react-router-dom";
import { Bot, Sparkles } from "lucide-react";

import { MockSourceBanner } from "../components/catalog/MockSourceBanner.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import {
  catalogSkills,
  getAgentsForSkill,
  MOCK_CATALOG_SOURCE,
} from "../mock/catalog.js";

const skillCategories = [...new Set(catalogSkills.map((skill) => skill.category))].toSorted();

const SkillsPage = () => {
  const linkedAgentCount = catalogSkills.reduce(
    (count, skill) => count + getAgentsForSkill(skill.id).length,
    0,
  );

  return (
    <div className="flex h-screen flex-col" data-read-only="true" data-source={MOCK_CATALOG_SOURCE}>
      <PageHeader title="Skills" subtitle="Mock-backed catalog preview of reusable capabilities" pendingCount={0} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <MockSourceBanner detail="Skill detail routes are not implemented yet, so this page intentionally stays list-only." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Catalog Skills" value={catalogSkills.length} icon={<Sparkles className="h-4 w-4" />} />
            <SummaryCard label="Categories" value={skillCategories.length} />
            <SummaryCard label="Agent Assignments" value={linkedAgentCount} icon={<Bot className="h-4 w-4" />} />
          </div>

          {skillCategories.map((category) => {
            const skills = catalogSkills.filter((skill) => skill.category === category);

            return (
              <section key={category} className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{category}</h2>
                  <p className="text-sm text-muted-foreground">Preview cards only. Use linked agent routes for deeper context.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {skills.map((skill) => {
                    const linkedAgents = getAgentsForSkill(skill.id);

                    return (
                      <article key={skill.id} className="rounded-xl border border-border bg-card/60 p-5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">{skill.name}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {linkedAgents.map((agent) => (
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
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SkillsPage;
