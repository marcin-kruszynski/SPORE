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
