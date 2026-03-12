import type {
  CreateMissionFormValues,
  CreateOperatorMissionInput,
  ResolveOperatorActionInput,
  SendOperatorMessageInput,
} from "../../types/operator-chat.js";

const OPERATOR_BY = "web-operator";
const OPERATOR_SOURCE = "web-operator-chat";

export function buildCreateMissionInput(
  values: CreateMissionFormValues,
): CreateOperatorMissionInput {
  return {
    message: values.objective.trim(),
    projectId: values.projectId.trim() || "spore",
    safeMode: values.safeMode,
    autoValidate: values.autoValidate,
    stub: values.useStubRuntime,
    by: OPERATOR_BY,
    source: OPERATOR_SOURCE,
  };
}

export function buildSendMessageInput(message: string): SendOperatorMessageInput {
  return {
    message: message.trim(),
    by: OPERATOR_BY,
    source: OPERATOR_SOURCE,
  };
}

export function buildResolveActionInput(
  choice: string,
): ResolveOperatorActionInput {
  return {
    choice,
    by: OPERATOR_BY,
    source: OPERATOR_SOURCE,
  };
}
