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
    editGoalPlan,
    getDocSuggestionsForRun,
    getGoalPlanHistory,
    getGoalPlanSummary,
    getIntegrationBranchSummary,
    getProposalReviewPackage,
    getProposalByRun,
    getProposalSummary,
    listSelfBuildDecisionSummaries,
    getSelfBuildDashboard,
    getSelfBuildLoopStatus,
    listSelfBuildQuarantineSummaries,
    listSelfBuildRollbackSummaries,
    getSelfBuildSummary,
    getSelfBuildWorkItem,
    getSelfBuildWorkItemRun,
    getWorkItemGroupSummary,
    getWorkItemTemplate,
    getWorkspaceDetail,
    getWorkspaceDetailByRun,
    listIntegrationBranchSummaries,
    listExecutionWorkspaces,
    listGoalPlansSummary,
    listSelfBuildWorkItemRuns,
    listSelfBuildWorkItems,
    listWorkItemGroupsSummary,
    listWorkItemTemplates,
    listWorkspaceSummaries,
    materializeGoalPlan,
    planProposalPromotion,
    quarantineSelfBuildTarget,
    requeueWorkItemGroupItem,
    reconcileManagedWorkspace,
    releaseSelfBuildQuarantine,
    rollbackIntegrationBranch,
    rerouteWorkItemGroup,
    retryDownstreamWorkItemGroup,
    rerunSelfBuildWorkItemRun,
    reviewGoalPlan,
    reviewProposalArtifact,
    runGoalPlan,
    runSelfBuildWorkItem,
    runWorkItemGroup,
    setWorkItemGroupDependencies,
    skipWorkItemGroupItem,
    startSelfBuildLoop,
    stopSelfBuildLoop,
    unblockWorkItemGroup,
    invokeProposalPromotion,
    validateWorkItemGroupBundle,
    validateWorkItemRun,
  } from "./self-build/self-build.js";

  export {
    getWorkItem,
    openOrchestratorDatabase,
    updateStep,
    updateWorkItem,
  } from "./store/execution-store.js";
}
