import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Toaster as Sonner } from "./components/ui/sonner.js";
import { Toaster } from "./components/ui/toaster.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { DashboardLayout } from "./components/dashboard/DashboardLayout.js";

const queryClient = new QueryClient();

const ChatPage = lazy(() => import("./pages/ChatPage.js"));
const MissionMapPage = lazy(() => import("./pages/MissionMapPage.js"));
const SelfBuildPage = lazy(() => import("./pages/SelfBuildPage.js"));
const EvidenceDetailPage = lazy(() => import("./pages/EvidenceDetailPage.js"));
const SpacesPage = lazy(() => import("./pages/SpacesPage.js"));
const SpaceDetailPage = lazy(() => import("./pages/SpaceDetailPage.js"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage.js"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage.js"));
const TeamsPage = lazy(() => import("./pages/TeamsPage.js"));
const TeamDetailPage = lazy(() => import("./pages/TeamDetailPage.js"));
const AgentsPage = lazy(() => import("./pages/AgentsPage.js"));
const AgentDetailPage = lazy(() => import("./pages/AgentDetailPage.js"));
const SkillsPage = lazy(() => import("./pages/SkillsPage.js"));
const ToolsPage = lazy(() => import("./pages/ToolsPage.js"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage.js"));
const WorkflowDetailPage = lazy(() => import("./pages/WorkflowDetailPage.js"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js"));
const NotFound = lazy(() => import("./pages/NotFound.js"));

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 text-sm text-muted-foreground">
      Loading mission control...
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DashboardLayout>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/mission-map" element={<MissionMapPage />} />
              <Route path="/self-build" element={<SelfBuildPage />} />
              <Route path="/evidence/:kind/:id" element={<EvidenceDetailPage />} />
              <Route path="/spaces" element={<SpacesPage />} />
              <Route path="/spaces/:id" element={<SpaceDetailPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/teams" element={<TeamsPage />} />
              <Route path="/teams/:id" element={<TeamDetailPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:id" element={<AgentDetailPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </DashboardLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
