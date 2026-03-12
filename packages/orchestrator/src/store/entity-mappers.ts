import { parseJsonField } from "./row-mappers.js";

export function mapScenarioRun(record) {
  return record
    ? {
        ...record,
        usesRealPi: Boolean(record.usesRealPi),
        assertionSummary: parseJsonField(record.assertionSummaryJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapScenarioRunExecution(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapRegressionRun(record) {
  return record
    ? {
        ...record,
        realPiRequired: Boolean(record.realPiRequired),
        summary: parseJsonField(record.summaryJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapRegressionRunItem(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapSchedulerEvaluation(record) {
  return record
    ? {
        ...record,
        dryRun: Boolean(record.dryRun),
        dueOnly: Boolean(record.dueOnly),
        summary: parseJsonField(record.summaryJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapWorkItem(record) {
  return record
    ? {
        ...record,
        acceptanceCriteria: parseJsonField(record.acceptanceJson, []),
        relatedDocs: parseJsonField(record.relatedDocsJson, []),
        relatedScenarios: parseJsonField(record.relatedScenariosJson, []),
        relatedRegressions: parseJsonField(record.relatedRegressionsJson, []),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapWorkItemRun(record) {
  return record
    ? {
        ...record,
        result: parseJsonField(record.resultJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapGoalPlan(record) {
  return record
    ? {
        ...record,
        constraints: parseJsonField(record.constraintsJson, {}),
        recommendations: parseJsonField(record.recommendationsJson, []),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapWorkItemGroup(record) {
  return record
    ? {
        ...record,
        summary: parseJsonField(record.summaryJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapProposalArtifact(record) {
  return record
    ? {
        ...record,
        summary: parseJsonField(record.summaryJson, {}),
        artifacts: parseJsonField(record.artifactsJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapWorkflowHandoff(record) {
  return record
    ? {
        ...record,
        toStepId: record.toStepId || null,
        targetRole: record.targetRole || null,
        summary: parseJsonField(record.summaryJson, {}),
        artifacts: parseJsonField(record.artifactsJson, {}),
        payload: parseJsonField(record.payloadJson, {}),
      }
    : null;
}

export function mapWorkspaceAllocation(record) {
  return record
    ? {
        ...record,
        safeMode: Number(record.safeMode) !== 0,
        mutationScope: parseJsonField(record.mutationScopeJson, []),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapLearningRecord(record) {
  return record
    ? {
        ...record,
        details: parseJsonField(record.detailsJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapIntegrationBranch(record) {
  return record
    ? {
        ...record,
        proposalArtifactIds: parseJsonField(record.proposalArtifactIdsJson, []),
        workspaceIds: parseJsonField(record.workspaceIdsJson, []),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapSelfBuildLoopState(record) {
  return record
    ? {
        ...record,
        policy: parseJsonField(record.policyJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapSelfBuildDecision(record) {
  return record
    ? {
        ...record,
        policy: parseJsonField(record.policyJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapOperatorThread(record) {
  return record
    ? {
        ...record,
        summary: parseJsonField(record.summaryJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapOperatorThreadMessage(record) {
  return record
    ? {
        ...record,
        payload: parseJsonField(record.payloadJson, {}),
      }
    : null;
}

export function mapOperatorThreadAction(record) {
  return record
    ? {
        ...record,
        payload: parseJsonField(record.payloadJson, {}),
        options: parseJsonField(record.optionsJson, {}),
        links: parseJsonField(record.linksJson, {}),
        resolution: parseJsonField(record.resolutionJson, {}),
      }
    : null;
}

export function mapQuarantineRecord(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapRollbackRecord(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapDocSuggestionRecord(record) {
  return record
    ? {
        ...record,
        payload: parseJsonField(record.payloadJson, {}),
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapSelfBuildIntakeRecord(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapSelfBuildOverrideRecord(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}

export function mapPolicyRecommendationReview(record) {
  return record
    ? {
        ...record,
        metadata: parseJsonField(record.metadataJson, {}),
      }
    : null;
}
