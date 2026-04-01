import type { Artifact } from "./artifact"
import type { DebateConfig } from "./config"

/**
 * Role-specific prompt builders.
 *
 * Each function returns a self-contained prompt string that includes:
 * - Role instructions
 * - Relevant context artifacts (task summary, prior phase outputs)
 * - Output format specification (JSON wrapped in ```json ... ```)
 *
 * No phase receives raw transcript content from another phase.
 * Only compact artifact objects are embedded.
 */

export namespace DebatePrompts {
  // ─── Shared helpers ───────────────────────────────────────────────────────

  function jsonBlock(value: unknown): string {
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```"
  }

  function outputInstruction(schema: string): string {
    return [
      "## Output format",
      "",
      `Respond with ONLY a JSON object matching this schema (no prose outside the JSON block):`,
      "",
      "```json",
      schema,
      "```",
    ].join("\n")
  }

  // ─── Phase 1: Planner ────────────────────────────────────────────────────

  export interface PlannerInput {
    task: string
    repoSummary: string
    relevantFiles: string
    plannerIndex: number
    totalPlanners: number
    constraints?: string[]
  }

  export function planner(input: PlannerInput): string {
    const constraintBlock =
      input.constraints && input.constraints.length > 0
        ? `## Constraints\n${input.constraints.map((c) => `- ${c}`).join("\n")}\n`
        : ""

    return [
      `You are Planner ${input.plannerIndex + 1} of ${input.totalPlanners} in a multi-agent planning session.`,
      "",
      "Your job is to independently analyze the task and produce a detailed implementation plan.",
      "Think carefully and independently — do NOT try to match what other planners might produce.",
      "",
      "## Task",
      input.task,
      "",
      "## Repository summary",
      input.repoSummary,
      "",
      ...(input.relevantFiles
        ? ["## Relevant files / modules", input.relevantFiles, ""]
        : []),
      constraintBlock,
      outputInstruction(`{
  "interpretation": "string — how you understand this task",
  "steps": ["string", "..."],
  "targetFiles": ["string", "..."],
  "risks": ["string", "..."],
  "validationNeeds": ["string", "..."]
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Phase 2: Critic ─────────────────────────────────────────────────────

  export interface CriticInput {
    task: string
    planToReview: Artifact.CandidatePlan
    otherPlanSummaries: string[]
    criticIndex: number
    constraints?: string[]
  }

  export function critic(input: CriticInput): string {
    const otherPlansBlock =
      input.otherPlanSummaries.length > 0
        ? [
            "## Other candidate plans (compact summaries)",
            input.otherPlanSummaries.map((s, i) => `### Plan ${i + 1}\n${s}`).join("\n\n"),
            "",
          ].join("\n")
        : ""

    const constraintBlock =
      input.constraints && input.constraints.length > 0
        ? `## Constraints\n${input.constraints.map((c) => `- ${c}`).join("\n")}\n`
        : ""

    return [
      `You are Critic ${input.criticIndex + 1} in a multi-agent critique session.`,
      "",
      "Your job is to rigorously review the candidate plan assigned to you.",
      "Find weaknesses, missed edge cases, and suggest improvements.",
      "Be specific and constructive.",
      "",
      "## Original task",
      input.task,
      "",
      constraintBlock,
      "## Candidate plan to review",
      jsonBlock(input.planToReview),
      "",
      otherPlansBlock,
      outputInstruction(`{
  "weaknesses": ["string", "..."],
  "missedCases": ["string", "..."],
  "betterAlternatives": ["string", "..."],
  "confidenceNotes": "string"
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Phase 3: Judge ──────────────────────────────────────────────────────

  export interface JudgeInput {
    task: string
    candidatePlans: Artifact.CandidatePlan[]
    critiqueResults: Artifact.CritiqueResult[]
    constraints?: string[]
  }

  export function judge(input: JudgeInput): string {
    const constraintBlock =
      input.constraints && input.constraints.length > 0
        ? `## Constraints\n${input.constraints.map((c) => `- ${c}`).join("\n")}\n`
        : ""

    return [
      "You are the Judge in a multi-agent planning session.",
      "",
      "Your job is to synthesize the best final implementation plan from the candidate plans and critiques.",
      "Do not simply pick a winner — merge the strongest ideas from each plan and address the critique findings.",
      "",
      "## Original task",
      input.task,
      "",
      constraintBlock,
      "## Candidate plans",
      jsonBlock(input.candidatePlans),
      "",
      "## Critique results",
      jsonBlock(input.critiqueResults),
      "",
      outputInstruction(`{
  "rationale": "string — why this plan was chosen / how it merges the best ideas",
  "steps": ["string", "..."],
  "targetFiles": ["string", "..."],
  "implementationChecklist": ["string", "..."],
  "validationChecklist": ["string", "..."]
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Phase 4: Implementer ────────────────────────────────────────────────

  export interface ImplementerInput {
    task: string
    finalPlan: Artifact.FinalPlan
    relevantFileContents: string
    implementerIndex: number
    totalImplementers: number
  }

  export function implementer(input: ImplementerInput): string {
    return [
      `You are Implementer ${input.implementerIndex + 1} of ${input.totalImplementers}.`,
      "",
      "Implement the final plan exactly as specified. Use tools to read files, make edits, run commands.",
      "After finishing, produce a brief summary of what you changed.",
      "",
      "## Original task",
      input.task,
      "",
      "## Final plan",
      jsonBlock(input.finalPlan),
      "",
      "## Relevant file context",
      input.relevantFileContents,
      "",
      "After completing all implementation, end your response with a JSON summary block:",
      "",
      outputInstruction(`{
  "changedFiles": ["string", "..."],
  "diffSummary": "string — short prose description of what was changed",
  "implementationNotes": "string (optional)"
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Phase 5: Reviewer ───────────────────────────────────────────────────

  export interface ReviewerInput {
    task: string
    finalPlan: Artifact.FinalPlan
    changedFiles: string[]
    diff: string
    testResults: string
    reviewerIndex: number
    strictness: DebateConfig.ReviewStrictness
  }

  const STRICTNESS_INSTRUCTIONS: Record<DebateConfig.ReviewStrictness, string> = {
    light: "Focus only on critical bugs and obvious errors. Do not nitpick style.",
    standard: "Look for bugs, logic errors, missing edge cases, and clear architectural problems.",
    strict: "Be thorough. Check for bugs, logic errors, edge cases, performance issues, architecture concerns, and any deviation from the plan.",
  }

  export function reviewer(input: ReviewerInput): string {
    return [
      `You are Reviewer ${input.reviewerIndex + 1} in a multi-agent code review session.`,
      "",
      `Review guideline: ${STRICTNESS_INSTRUCTIONS[input.strictness]}`,
      "",
      "## Original task",
      input.task,
      "",
      "## Implementation plan that was followed",
      jsonBlock(input.finalPlan),
      "",
      "## Changed files",
      input.changedFiles.join(", "),
      "",
      "## Diff",
      "```diff",
      input.diff,
      "```",
      "",
      ...(input.testResults ? ["## Test / validation results", input.testResults, ""] : []),
      outputInstruction(`{
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "file": "string (optional)",
      "description": "string",
      "suggestedFix": "string (optional)"
    }
  ],
  "potentialRegressions": ["string", "..."],
  "architectureConcerns": ["string", "..."],
  "overallAssessment": "approve|request_changes|needs_work"
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Phase 7: Repair agent ───────────────────────────────────────────────

  export interface RepairInput {
    task: string
    finalPlan: Artifact.FinalPlan
    relevantFindings: Artifact.ReviewFinding[]
    validationFailures: string[]
    changedFiles: string[]
    fileContents: string
    loopIndex: number
  }

  export function repair(input: RepairInput): string {
    return [
      `You are the Repair Agent (loop ${input.loopIndex + 1}).`,
      "",
      "Fix the issues identified by reviewers and/or validation failures.",
      "Focus only on the reported findings — do not introduce unrelated changes.",
      "",
      "## Original task",
      input.task,
      "",
      "## Final plan (for reference)",
      jsonBlock(input.finalPlan),
      "",
      "## Issues to fix",
      jsonBlock(input.relevantFindings),
      "",
      ...(input.validationFailures.length > 0
        ? [
            "## Validation failures",
            input.validationFailures.map((f) => `- ${f}`).join("\n"),
            "",
          ]
        : []),
      "## Current file context",
      input.fileContents,
      "",
      "After completing repairs, end your response with a JSON summary:",
      "",
      outputInstruction(`{
  "findingsAddressed": ["string", "..."],
  "changedFiles": ["string", "..."],
  "diffSummary": "string"
}`),
    ]
      .join("\n")
      .trim()
  }

  // ─── Helpers for context budgeting ───────────────────────────────────────

  /** Produce a compact summary of a candidate plan (for critics reviewing other plans). */
  export function summarizePlan(plan: Artifact.CandidatePlan): string {
    return [
      `Planner ${plan.plannerIndex + 1} interpretation: ${plan.interpretation}`,
      `Steps: ${plan.steps.slice(0, 5).join("; ")}${plan.steps.length > 5 ? ` (+${plan.steps.length - 5} more)` : ""}`,
      `Target files: ${plan.targetFiles.slice(0, 8).join(", ")}`,
      `Risks: ${plan.risks.slice(0, 3).join("; ")}`,
    ].join("\n")
  }

  /**
   * Parse the JSON artifact from an LLM response.
   * The LLM is instructed to output JSON wrapped in ```json ... ```.
   * Falls back to raw JSON parsing if no code fence is present.
   */
  export function parseArtifact<T>(text: string): T {
    // Try to extract from ```json ... ``` block
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i)
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1].trim())
    }

    // Try to find a JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    throw new Error(`Could not extract JSON artifact from LLM response. Response was:\n${text.slice(0, 500)}`)
  }
}
