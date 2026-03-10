// biome-ignore-all lint/suspicious/noExplicitAny: wave helpers normalize additive workflow policy payloads across many execution shapes.

type StepLike = Record<string, any>;
type LooseObject = Record<string, any>;

function asJsonObject(value: unknown): LooseObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseObject)
    : {};
}

export function getStepAgeMs(step: StepLike) {
  const reference = step.launchedAt ?? step.createdAt ?? null;
  if (!reference) {
    return 0;
  }
  const parsed = Date.parse(reference);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(0, Date.now() - parsed);
}

export function getStepPolicy(step: StepLike | null) {
  return asJsonObject(step?.policy);
}

export function getStepWave(step: StepLike | null) {
  return Number.isInteger(step?.wave)
    ? (step?.wave as number)
    : (step?.sequence ?? 0);
}

export function getActiveSteps<T extends StepLike>(steps: T[]) {
  return steps.filter(
    (step) => step.state === "active" || step.state === "launching",
  );
}

export function getWaveGate(steps: StepLike[], wave: number) {
  const waveStep = steps.find((step) => getStepWave(step) === wave) ?? null;
  return (
    asJsonObject(getStepPolicy(waveStep).workflowPolicy).waveGate ?? {
      mode: "all",
    }
  );
}

export function getWavePolicy(steps: StepLike[], wave: number) {
  const waveStep = steps.find((step) => getStepWave(step) === wave) ?? null;
  return asJsonObject(getStepPolicy(waveStep).workflowPolicy).wavePolicy ?? {};
}

export function getWaveSteps<T extends StepLike>(steps: T[], wave: number) {
  return steps.filter((step) => getStepWave(step) === wave);
}

export function isWaveSatisfied<T extends StepLike>(
  steps: T[],
  wave: number,
  successStates = new Set(["completed"]),
) {
  const waveSteps = getWaveSteps(steps, wave);
  if (waveSteps.length === 0) {
    return true;
  }
  const gate = getWaveGate(steps, wave) as {
    mode?: string;
    count?: number | string;
  };
  const successCount = waveSteps.filter((step) =>
    successStates.has(step.state),
  ).length;
  const mode = gate?.mode ?? "all";
  if (mode === "any") {
    return successCount >= 1;
  }
  if (mode === "min_success_count") {
    const target = Math.max(1, Number.parseInt(String(gate?.count ?? 1), 10));
    return successCount >= target;
  }
  return successCount >= waveSteps.length;
}

export function getWaveStartedAt<T extends StepLike>(steps: T[], wave: number) {
  const candidates = getWaveSteps(steps, wave)
    .map((step) => step.launchedAt ?? null)
    .filter(Boolean)
    .map((value) => Date.parse(value as string))
    .filter((value) => Number.isFinite(value));
  if (candidates.length === 0) {
    return null;
  }
  return new Date(Math.min(...candidates)).toISOString();
}

export function getWaveAgeMs<T extends StepLike>(steps: T[], wave: number) {
  const startedAt = getWaveStartedAt(steps, wave);
  if (!startedAt) {
    return 0;
  }
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Date.now() - parsed);
}

export function getNextLaunchableSteps<T extends StepLike>(
  steps: T[],
  successStates = new Set(["completed"]),
) {
  const planned = steps.filter((step) => step.state === "planned");
  if (planned.length === 0) {
    return [];
  }
  const candidateWaves = [
    ...new Set(planned.map((step) => getStepWave(step))),
  ].sort((left, right) => left - right);
  for (const wave of candidateWaves) {
    const lowerWaves = [
      ...new Set(
        steps.map((step) => getStepWave(step)).filter((value) => value < wave),
      ),
    ];
    if (
      lowerWaves.every((value) => isWaveSatisfied(steps, value, successStates))
    ) {
      return planned
        .filter((step) => getStepWave(step) === wave)
        .sort((left, right) => left.sequence - right.sequence);
    }
  }
  return [];
}

export function hasPlannedSteps<T extends StepLike>(steps: T[]) {
  return steps.some((step) => step.state === "planned");
}

export function findBlockedWave<T extends StepLike>(
  steps: T[],
  successStates = new Set(["completed"]),
) {
  const waves = [...new Set(steps.map((step) => getStepWave(step)))].sort(
    (left, right) => left - right,
  );
  for (const wave of waves) {
    const waveSteps = getWaveSteps(steps, wave);
    const hasPlanned = waveSteps.some((step) => step.state === "planned");
    const hasActive = waveSteps.some(
      (step) => step.state === "active" || step.state === "launching",
    );
    if (!hasPlanned && !hasActive) {
      continue;
    }
    const lowerWaves = waves.filter((value) => value < wave);
    if (
      lowerWaves.some((value) => !isWaveSatisfied(steps, value, successStates))
    ) {
      return wave;
    }
  }
  return null;
}

export function summarizeStepStates<T extends StepLike>(
  steps: T[],
  successStates = new Set(["completed"]),
) {
  const byState: Record<string, number> = {};
  const byWave: Record<number, Record<string, unknown>> = {};
  for (const step of steps) {
    byState[step.state] = (byState[step.state] ?? 0) + 1;
    const wave = Number.isInteger(step.wave) ? (step.wave as number) : 0;
    if (!byWave[wave]) {
      byWave[wave] = {
        wave,
        gate: getWaveGate(steps, wave),
        satisfied: false,
        count: 0,
        byState: {},
      };
    }
    byWave[wave].count = Number(byWave[wave].count ?? 0) + 1;
    const waveStates = asJsonObject(byWave[wave].byState);
    waveStates[step.state] = Number(waveStates[step.state] ?? 0) + 1;
    byWave[wave].byState = waveStates;
  }
  return {
    count: steps.length,
    byState,
    byWave: (Object.values(byWave) as LooseObject[])
      .map((entry) => ({
        ...entry,
        satisfied: isWaveSatisfied(
          steps,
          Number(entry.wave ?? 0),
          successStates,
        ),
      }))
      .sort(
        (left, right) =>
          Number((left as LooseObject).wave ?? 0) -
          Number((right as LooseObject).wave ?? 0),
      ),
  };
}
