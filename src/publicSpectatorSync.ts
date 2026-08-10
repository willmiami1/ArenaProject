import type { PublicCompetition, PublicPredictionRun } from "./publicData";

export function effectiveActivePredictionRun(
  competition: PublicCompetition | undefined,
): PublicPredictionRun | undefined {
  if (!competition?.activePredictionRunId) return undefined;
  return competition.predictionRuns.find(
    (run) => run.id === competition.activePredictionRunId,
  );
}

export function submissionMatchesCurrentRun(
  submittedRunId: string,
  currentRunId: string,
  responseRunId: string | undefined,
) {
  return Boolean(
    submittedRunId &&
      submittedRunId === currentRunId &&
      submittedRunId === responseRunId,
  );
}

export class PublicPollGuard {
  private sequence = 0;
  private activeRequest: number | null = null;

  begin() {
    if (this.activeRequest !== null) return null;
    this.activeRequest = ++this.sequence;
    return this.activeRequest;
  }

  complete(request: number) {
    if (request !== this.activeRequest) return false;
    this.activeRequest = null;
    return true;
  }

  cancel() {
    this.sequence += 1;
    this.activeRequest = null;
  }
}
