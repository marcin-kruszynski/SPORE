type AttentionLike = {
  groupId?: string | null;
  goalPlanId?: string | null;
  attentionState?: string | null;
};

export function buildQueueSummary(
  urgentWork: AttentionLike[] = [],
  followUpWork: AttentionLike[] = [],
) {
  const all = [...urgentWork, ...followUpWork];
  const byGroup = all.reduce<Record<string, Record<string, unknown>>>(
    (accumulator, item) => {
      const key = item.groupId ?? "ungrouped";
      const entry = (accumulator[key] ?? {
        count: 0,
        attentionStates: {},
        groupId: item.groupId ?? null,
        goalPlanId: item.goalPlanId ?? null,
      }) as {
        count: number;
        attentionStates: Record<string, number>;
      };
      entry.count += 1;
      const state = item.attentionState ?? "healthy";
      entry.attentionStates[state] = (entry.attentionStates[state] ?? 0) + 1;
      accumulator[key] = entry;
      return accumulator;
    },
    {},
  );
  const byGoalPlan = all.reduce<Record<string, number>>((accumulator, item) => {
    const key = item.goalPlanId ?? "no-goal-plan";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    total: all.length,
    urgent: urgentWork.length,
    followUp: followUpWork.length,
    byGroup,
    byGoalPlan,
  };
}
