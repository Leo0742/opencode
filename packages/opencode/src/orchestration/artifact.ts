import z from "zod"

/**
 * Compact structured artifacts passed between pipeline phases.
 *
 * Design principle: no phase receives raw transcript content from another
 * phase. Instead, each phase produces a small structured artifact that
 * captures only the signal its successor needs. This keeps context windows
 * small and makes the pipeline robust even for large tasks.
 */

export namespace Artifact {
  // ─── Phase 1 output ──────────────────────────────────────────────────────

  export const CandidatePlan = z.object({
    plannerIndex: z.number(),
    sessionID: z.string().optional(),
    interpretation: z.string().describe("How this planner understood the task"),
    steps: z.array(z.string()).describe("Ordered implementation steps"),
    targetFiles: z.array(z.string()).describe("Files/modules expected to be touched"),
    risks: z.array(z.string()).describe("Known risks or tricky areas"),
    validationNeeds: z.array(z.string()).describe("Tests or checks that should validate the result"),
  })
  export type CandidatePlan = z.infer<typeof CandidatePlan>

  // ─── Phase 2 output ──────────────────────────────────────────────────────

  export const CritiqueResult = z.object({
    criticIndex: z.number(),
    targetPlannerIndex: z.number(),
    sessionID: z.string().optional(),
    weaknesses: z.array(z.string()),
    missedCases: z.array(z.string()),
    betterAlternatives: z.array(z.string()),
    confidenceNotes: z.string(),
  })
  export type CritiqueResult = z.infer<typeof CritiqueResult>

  // ─── Phase 3 output ──────────────────────────────────────────────────────

  export const FinalPlan = z.object({
    sessionID: z.string().optional(),
    rationale: z.string().describe("Why this plan was selected / how it merges the best ideas"),
    steps: z.array(z.string()),
    targetFiles: z.array(z.string()),
    implementationChecklist: z.array(z.string()),
    validationChecklist: z.array(z.string()),
  })
  export type FinalPlan = z.infer<typeof FinalPlan>

  // ─── Phase 4 output ──────────────────────────────────────────────────────

  export const ImplementationResult = z.object({
    implementerIndex: z.number(),
    sessionID: z.string().optional(),
    changedFiles: z.array(z.string()),
    diffSummary: z.string().describe("Short prose summary of what was changed"),
    implementationNotes: z.string().optional(),
  })
  export type ImplementationResult = z.infer<typeof ImplementationResult>

  // ─── Phase 5 output ──────────────────────────────────────────────────────

  export const Severity = z.enum(["critical", "major", "minor", "info"])
  export type Severity = z.infer<typeof Severity>

  export const ReviewFinding = z.object({
    severity: Severity,
    file: z.string().optional(),
    description: z.string(),
    suggestedFix: z.string().optional(),
  })
  export type ReviewFinding = z.infer<typeof ReviewFinding>

  export const ReviewerResult = z.object({
    reviewerIndex: z.number(),
    sessionID: z.string().optional(),
    findings: z.array(ReviewFinding),
    potentialRegressions: z.array(z.string()),
    architectureConcerns: z.array(z.string()),
    overallAssessment: z.enum(["approve", "request_changes", "needs_work"]),
  })
  export type ReviewerResult = z.infer<typeof ReviewerResult>

  // ─── Phase 6 output ──────────────────────────────────────────────────────

  export const ValidationResult = z.object({
    passed: z.boolean(),
    testsRan: z.boolean(),
    lintRan: z.boolean(),
    typecheckRan: z.boolean(),
    buildRan: z.boolean(),
    summary: z.string(),
    failureDetails: z.array(z.string()).optional(),
  })
  export type ValidationResult = z.infer<typeof ValidationResult>

  // ─── Repair history entry ─────────────────────────────────────────────────

  export const RepairEntry = z.object({
    loopIndex: z.number(),
    sessionID: z.string().optional(),
    findingsAddressed: z.array(z.string()),
    changedFiles: z.array(z.string()),
    diffSummary: z.string(),
  })
  export type RepairEntry = z.infer<typeof RepairEntry>

  // ─── Full debate run result ───────────────────────────────────────────────

  export const DebatePhase = z.enum([
    "planning",
    "critique",
    "judge",
    "implementation",
    "review",
    "verification",
    "repair",
    "finalization",
    "complete",
    "failed",
  ])
  export type DebatePhase = z.infer<typeof DebatePhase>

  export const DebateResult = z.object({
    debateID: z.string(),
    parentSessionID: z.string(),
    status: z.enum(["success", "partial_success", "failed"]),
    phase: DebatePhase,

    // Phase artifacts
    candidatePlans: z.array(CandidatePlan),
    critiqueResults: z.array(CritiqueResult),
    finalPlan: FinalPlan.optional(),
    selectedImplementation: ImplementationResult.optional(),
    allImplementations: z.array(ImplementationResult),
    reviewerResults: z.array(ReviewerResult),
    validationResult: ValidationResult.optional(),
    repairHistory: z.array(RepairEntry),

    // Diagnostics
    totalRepairLoops: z.number(),
    error: z.string().optional(),
  })
  export type DebateResult = z.infer<typeof DebateResult>

  /** Mutable in-flight state for one debate run. */
  export interface RunState {
    debateID: string
    parentSessionID: string
    phase: DebatePhase
    candidatePlans: CandidatePlan[]
    critiqueResults: CritiqueResult[]
    finalPlan?: FinalPlan
    implementations: ImplementationResult[]
    selectedImplementation?: ImplementationResult
    reviewerResults: ReviewerResult[]
    validationResult?: ValidationResult
    repairHistory: RepairEntry[]
    repairLoopCount: number
    error?: string
  }

  export function createRunState(debateID: string, parentSessionID: string): RunState {
    return {
      debateID,
      parentSessionID,
      phase: "planning",
      candidatePlans: [],
      critiqueResults: [],
      implementations: [],
      reviewerResults: [],
      repairHistory: [],
      repairLoopCount: 0,
    }
  }

  export function toResult(state: RunState): DebateResult {
    const hasErrors = !!state.error
    const validationPassed = state.validationResult?.passed ?? false
    const criticalFindings = state.reviewerResults.flatMap((r) =>
      r.findings.filter((f) => f.severity === "critical"),
    )

    let status: DebateResult["status"] = "success"
    if (hasErrors) status = "failed"
    else if (!validationPassed || criticalFindings.length > 0) status = "partial_success"

    return {
      debateID: state.debateID,
      parentSessionID: state.parentSessionID,
      status,
      phase: state.phase,
      candidatePlans: state.candidatePlans,
      critiqueResults: state.critiqueResults,
      finalPlan: state.finalPlan,
      selectedImplementation: state.selectedImplementation,
      allImplementations: state.implementations,
      reviewerResults: state.reviewerResults,
      validationResult: state.validationResult,
      repairHistory: state.repairHistory,
      totalRepairLoops: state.repairLoopCount,
      error: state.error,
    }
  }
}
