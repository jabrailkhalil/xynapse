import type { BVCDecisionAxisId } from "./decisions.js";

export interface AxisDisagreementStats {
  axis: BVCDecisionAxisId;
  m: number;
  d_vote?: number;
  d_cov: number;
  voteCounts: Record<string, number>;
}

/** Diagnostics of stated decisions, never a probability of correctness. */
export interface DisagreementResult {
  D_vote: number | undefined;
  D_cov: number;
  T_ge2: BVCDecisionAxisId[];
  axisStats: AxisDisagreementStats[];
}

export type BvcPhase = "analysis" | "recovery" | "critique" | "plan";
export interface HistoryEntry {
  agent: string;
  content: string;
  phase: BvcPhase;
  round: number;
}

export interface BvcRole {
  name: string;
  modelId: string;
  systemPrompt?: string;
}

export interface BvcMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Cumulative usage for a single request, including provider reasoning tokens. */
export interface BvcUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BvcModelChunk {
  text?: string;
  usage?: BvcUsage;
  finishReason?: "stop" | "length" | "refusal" | "unknown";
}

export interface BvcModelRequest {
  modelId: string;
  role: string;
  phase: BvcPhase;
  messages: BvcMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

/** A host owns all networking, credentials, provider options, and model choice. */
export interface BvcModelAdapter {
  stream(request: BvcModelRequest): AsyncIterable<BvcModelChunk>;
}

export interface BvcOptions {
  /** council: explicit multi-role request; adaptive: opt-in heuristic routing. */
  mode?: "council" | "adaptive" | "single" | "fixed";
  maxCalls?: number;
  maxCritiqueRounds?: number;
  maxRecoveryAttempts?: number;
  maxPromptChars?: number;
  maxResponseChars?: number;
  callTimeoutMs?: number;
  analysisMaxTokens?: number;
  critiqueMaxTokens?: number;
  recoveryMaxTokens?: number;
  synthesisMaxTokens?: number;
  tauVote?: number;
  tauCrit?: number;
  tauCov?: number;
  lambdaCost?: number;
  epsilonVote?: number;
  epsilonCov?: number;
}

export interface BvcInput {
  task: string;
  context?: string;
  roles: BvcRole[];
  adapter: BvcModelAdapter;
  synthesisModelId?: string;
  options?: BvcOptions;
  signal?: AbortSignal;
}

export interface BvcCallRecord {
  index: number;
  attempted: boolean;
  role: string;
  modelId: string;
  phase: BvcPhase;
  round: number;
  status:
    | "complete"
    | "error"
    | "timeout"
    | "cancelled"
    | "truncated"
    | "refused"
    | "input_limit";
  finishReason: BvcModelChunk["finishReason"];
  /** False when a host does not expose the provider's finish reason. */
  completionConfirmed: boolean;
  inputChars: number;
  /** Raw report characters omitted from bounded head/tail evidence excerpts. */
  omittedEvidenceChars: number;
  outputChars: number;
  elapsedMs: number;
  usage?: BvcUsage;
}

export interface BvcResult {
  policyVersion: "bvc-portable-v1";
  status: "planned" | "failed" | "cancelled";
  route: "council" | "single";
  reason: string;
  plan?: string;
  verification: "not_run";
  callsUsed: number;
  callLimit: number;
  critiqueRounds: number;
  distinctModels: number;
  /** False if any attempted provider call did not return usage. */
  usageComplete: boolean;
  reportedUsage: BvcUsage;
  calls: BvcCallRecord[];
  history: HistoryEntry[];
  disagreement?: DisagreementResult;
}

export type BvcEvent =
  | { type: "route"; route: BvcResult["route"]; reason: string }
  | {
      type: "call";
      role: string;
      phase: BvcPhase;
      round: number;
      index: number;
    }
  | { type: "text"; role: string; phase: BvcPhase; text: string }
  | { type: "call_end"; call: BvcCallRecord }
  | { type: "metrics"; round: number; disagreement: DisagreementResult }
  | { type: "critique_decision"; allowed: boolean; reason: string }
  | { type: "complete"; result: BvcResult };
