export interface BvcPreflightSignals {
  nFiles: number;
  nSignatures: number;
  files: number;
  signatures: number;
  conflict: number;
  trim: number;
  multiRoot: number;
  specGap: number;
}

export interface BvcPreflightResult {
  uncertainty: number;
  rawUncertainty: number;
  hardSignals: number;
  triggerCouncil: boolean;
  signals: BvcPreflightSignals;
}

export interface BvcCritiqueInput {
  dVote: number | undefined;
  dCov: number;
  comparableAxes: number;
  uncertainty: number;
  tauVote: number;
  tauCrit: number;
  tauCov: number;
  round: number;
  maxRounds: number;
  activeRoles: number;
  usedBudget: number;
  totalBudget: number;
  reserve: number;
  lastImproved: boolean;
  lambdaCost: number;
  epsilonNum: number;
}

export interface BvcCritiqueDecision {
  allowed: boolean;
  gain: number;
  cost: number;
  freeBudget: number;
  reason: string;
}

const FILE_PATTERN = /(?:[a-z]:[\\/])?(?:[\w.@-]+[\\/])*[\w.@-]+\.(?:c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|kt|md|php|py|rb|rs|sql|swift|toml|ts|tsx|vue|xml|ya?ml)/gi;
const ERROR_PATTERN = /\b(?:assert(?:ion)?|error|exception|fail(?:ed|ure)?|panic|traceback)\b|ошиб|исключен|падает|сбой|трассиров/iu;
const AMBIGUITY_PATTERN = /\b(?:ambiguous|either|maybe|one of|or|unclear|unknown)\b|неясн|возможно|либо|или один из|неизвест/iu;
const CONFLICT_PATTERN = /conflict(?:s|ing)? with|contradict(?:s|ion)?|log points to.+(?:but|while).+(?:issue|stack)|противореч|лог указывает.+(?:но|тогда как).+(?:issue|стек|описан)/iu;

const clip01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Deterministic-safe preflight from Appendix A, without LLM or test outcomes. */
export function computeBvcPreflight(task: string): BvcPreflightResult {
  const fileMatches = task.match(FILE_PATTERN) ?? [];
  const uniqueFiles = new Set(fileMatches.map((value) => value.toLowerCase().replace(/\\/g, "/")));
  const nFiles = uniqueFiles.size;

  const signatureUnits = task
    .split(/[\r\n]+|(?<=[.!?])\s+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0 && ERROR_PATTERN.test(value));
  const nSignatures = new Set(signatureUnits).size;

  const files = Math.min(1, Math.max(0, nFiles - 1) / 4);
  const signatures = Math.min(1, Math.max(0, nSignatures - 1) / 2);
  const conflict = CONFLICT_PATTERN.test(task) ? 1 : 0;
  const trim = 0; // CollectContext currently does not expose a deterministic trim ratio.
  const multiRoot = nFiles > 0 ? 1 - 1 / nFiles : 0;
  const specGap = nSignatures === 0 || AMBIGUITY_PATTERN.test(task) ? 1 : 0;

  const rawUncertainty = clip01(
    -0.10
      + 0.22 * files
      + 0.18 * signatures
      + 0.18 * conflict
      + 0.16 * trim
      + 0.22 * multiRoot
      + 0.14 * specGap,
  );
  const hardSignals = [
    files > 0.5,
    signatures > 0,
    conflict === 1,
    trim > 0.25,
    multiRoot > 0.4,
    specGap === 1,
  ].filter(Boolean).length;
  const uncertainty = hardSignals >= 2 ? rawUncertainty : 0;
  const triggerCouncil = uncertainty > 0.45 || (hardSignals >= 3 && nFiles >= 2);

  return {
    uncertainty,
    rawUncertainty,
    hardSignals,
    triggerCouncil,
    signals: {
      nFiles,
      nSignatures,
      files,
      signatures,
      conflict,
      trim,
      multiRoot,
      specGap,
    },
  };
}

/** Rule-based WorthCritique from Appendix A. */
export function evaluateBvcCritique(input: BvcCritiqueInput): BvcCritiqueDecision {
  const freeBudget = Math.max(0, input.totalBudget - input.usedBudget - input.reserve);
  const cost = input.lambdaCost * input.activeRoles / Math.max(1, freeBudget);
  const voteExcess = Math.max(0, (input.dVote ?? 0) - input.tauVote);
  const voteRange = Math.max(input.epsilonNum, input.tauCrit - input.tauVote);
  const coverageFactor = 1 - Math.min(
    1,
    input.dCov / Math.max(input.epsilonNum, input.tauCov),
  );
  const budgetFactor = Math.min(1, freeBudget / Math.max(1, input.activeRoles));
  const gain = input.uncertainty * voteExcess / voteRange * coverageFactor * budgetFactor;

  let reason = "expected gain does not exceed cost";
  let allowed = true;
  if (input.comparableAxes === 0 || input.dVote === undefined) {
    allowed = false;
    reason = "no axis has two valid votes";
  } else if (input.dCov > input.tauCov) {
    allowed = false;
    reason = "structured-output coverage is degraded";
  } else if (input.dVote <= input.tauVote) {
    allowed = false;
    reason = "voting disagreement is within threshold";
  } else if (input.round >= input.maxRounds) {
    allowed = false;
    reason = "critique round limit reached";
  } else if (input.activeRoles < 2) {
    allowed = false;
    reason = "fewer than two active roles";
  } else if (input.usedBudget + input.activeRoles + input.reserve > input.totalBudget) {
    allowed = false;
    reason = "critique would consume the reserved synthesis budget";
  } else if (input.round > 0 && !input.lastImproved) {
    allowed = false;
    reason = "previous critique did not improve disagreement and coverage";
  } else if (gain <= cost) {
    allowed = false;
  } else {
    reason = "expected gain exceeds cost";
  }

  return { allowed, gain, cost, freeBudget, reason };
}

export function didBvcCritiqueImprove(
  previousVote: number | undefined,
  previousCoverage: number,
  nextVote: number | undefined,
  nextCoverage: number,
  epsilonVote: number,
  epsilonCoverage: number,
): boolean {
  return previousVote !== undefined
    && nextVote !== undefined
    && nextVote <= previousVote - epsilonVote
    && nextCoverage <= previousCoverage + epsilonCoverage;
}
