declare module "@spore/orchestrator" {
  export {
    createExecution,
    getExecutionDetail,
    listExecutionEvents,
    spawnExecutionBranches,
  } from "./execution/workflow-execution.js";

  export { planWorkflowInvocation } from "./invocation/plan-workflow-invocation.js";

  export { transitionStepRecord } from "./lifecycle/execution-lifecycle.js";

  export {
    getRegressionLatestReport,
    getRegressionRunReport,
    getRegressionRunSummaryById,
    getRegressionSchedulerStatus,
    getRegressionTrends,
    getRunCenterSummary,
    getScenarioRunArtifacts,
    getScenarioRunSummaryById,
    getScenarioTrends,
  } from "./scenarios/run-history.js";

  export {
    approveProposalArtifact,
    cleanupManagedWorkspace,
    createGoalPlan,
    createManagedWorkItem,
    getDocSuggestionsForRun,
    getGoalPlanSummary,
    getProposalReviewPackage,
    getProposalByRun,
    getProposalSummary,
    getSelfBuildDashboard,
    getSelfBuildSummary,
    getSelfBuildWorkItem,
    getSelfBuildWorkItemRun,
    getWorkItemGroupSummary,
    getWorkItemTemplate,
    getWorkspaceDetail,
    getWorkspaceDetailByRun,
    listExecutionWorkspaces,
    listGoalPlansSummary,
    listSelfBuildWorkItemRuns,
    listSelfBuildWorkItems,
    listWorkItemGroupsSummary,
    listWorkItemTemplates,
    listWorkspaceSummaries,
    materializeGoalPlan,
    planProposalPromotion,
    reconcileManagedWorkspace,
    rerunSelfBuildWorkItemRun,
    reviewGoalPlan,
    reviewProposalArtifact,
    runGoalPlan,
    runSelfBuildWorkItem,
    runWorkItemGroup,
    setWorkItemGroupDependencies,
    invokeProposalPromotion,
    validateWorkItemRun,
  } from "./self-build/self-build.js";

  export {
    getWorkItem,
    openOrchestratorDatabase,
    updateStep,
    updateWorkItem,
  } from "./store/execution-store.js";
}
