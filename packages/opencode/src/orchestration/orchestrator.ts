import { ulid } from "ulid"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { SessionID } from "../session/schema"
import { Provider } from "../provider/provider"
import { ProviderID, ModelID } from "../provider/schema"
import { Artifact } from "./artifact"
import { DebateConfig } from "./config"
import { DebatePrompts } from "./prompts"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import z from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "orchestration" })

// ─── Bus Events ───────────────────────────────────────────────────────────────

export const DebateEvent = {
  PhaseChanged: BusEvent.define(
    "debate.phase.changed",
    z.object({
      debateID: z.string(),
      parentSessionID: z.string(),
      phase: Artifact.DebatePhase,
    }),
  ),

  PhaseCompleted: BusEvent.define(
    "debate.phase.completed",
    z.object({
      debateID: z.string(),
      parentSessionID: z.string(),
      phase: Artifact.DebatePhase,
      summary: z.string(),
    }),
  ),

  Completed: BusEvent.define(
    "debate.completed",
    z.object({
      debateID: z.string(),
      parentSessionID: z.string(),
      result: Artifact.DebateResult,
    }),
  ),

  Failed: BusEvent.define(
    "debate.failed",
    z.object({
      debateID: z.string(),
      parentSessionID: z.string(),
      phase: Artifact.DebatePhase,
      error: z.string(),
    }),
  ),
}

// ─── Input / Output types ────────────────────────────────────────────────────

export interface DebateInput {
  /** The user's task description. */
  task: string
  /** The parent session this debate is attached to. */
  parentSessionID: string
  /** Full pipeline configuration (use DebateConfig.resolve() to get one from a preset). */
  config: DebateConfig.PipelineConfig
  /** Base model to use for all phases unless overridden per-role. */
  model?: { providerID: string; modelID: string }
  /** Optional repo / project summary to give planners context. */
  repoSummary?: string
  /** Optional relevant file contents to give planners and implementers. */
  relevantFiles?: string
  /** Optional hard constraints to pass into all prompts. */
  constraints?: string[]
  /** Optional AbortSignal for cancellation. */
  abortSignal?: AbortSignal
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const READ_ONLY_PERMISSIONS = [
  { permission: "edit" as const, pattern: "*" as const, action: "deny" as const },
  { permission: "write" as const, pattern: "*" as const, action: "deny" as const },
  { permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const },
  { permission: "task" as const, pattern: "*" as const, action: "deny" as const },
]

interface AgentSessionOptions {
  parentSessionID: string
  title: string
  prompt: string
  model: { providerID: string; modelID: string }
  agentName: "general" | "build" | "explore"
  readOnly: boolean
  abortSignal?: AbortSignal
}

/**
 * Create a child session, run the given prompt, and return the last text output.
 */
async function runAgentSession(opts: AgentSessionOptions): Promise<{ text: string; sessionID: string }> {
  const session = await Session.create({
    parentID: SessionID.make(opts.parentSessionID),
    title: opts.title,
    permission: opts.readOnly ? READ_ONLY_PERMISSIONS : undefined,
  })

  const parts = await SessionPrompt.resolvePromptParts(opts.prompt)

  if (opts.abortSignal?.aborted) {
    throw new Error("Debate run was cancelled")
  }

  const abortController = new AbortController()
  function onAbort() {
    abortController.abort()
    SessionPrompt.cancel(session.id).catch(() => {})
  }
  opts.abortSignal?.addEventListener("abort", onAbort)

  try {
    const result = await SessionPrompt.prompt({
      sessionID: session.id,
      model: {
        modelID: ModelID.make(opts.model.modelID),
        providerID: ProviderID.make(opts.model.providerID),
      },
      agent: opts.agentName,
      parts,
    })

    const text = result.parts.findLast((p) => p.type === "text")?.text ?? ""
    return { text, sessionID: session.id }
  } finally {
    opts.abortSignal?.removeEventListener("abort", onAbort)
  }
}

/** Pick the model for a role, falling back to the base model. */
function modelForRole(
  role: keyof DebateConfig.PipelineConfig["models"],
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
): { providerID: string; modelID: string } {
  const override = config.models[role]
  if (override?.providerID && override?.modelID) {
    return { providerID: override.providerID, modelID: override.modelID }
  }
  return baseModel
}

async function publishPhaseChange(state: Artifact.RunState, phase: Artifact.DebatePhase) {
  state.phase = phase
  await Bus.publish(DebateEvent.PhaseChanged, {
    debateID: state.debateID,
    parentSessionID: state.parentSessionID,
    phase,
  })
}

async function publishPhaseComplete(state: Artifact.RunState, summary: string) {
  await Bus.publish(DebateEvent.PhaseCompleted, {
    debateID: state.debateID,
    parentSessionID: state.parentSessionID,
    phase: state.phase,
    summary,
  })
}

// ─── Phase runners ────────────────────────────────────────────────────────────

async function runPlanningPhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
): Promise<void> {
  await publishPhaseChange(state, "planning")
  log.info("debate: planning phase", { planners: config.planners, debateID: state.debateID })

  const model = modelForRole("planner", config, baseModel)

  const plannerPromises = Array.from({ length: config.planners }, async (_, i) => {
    const prompt = DebatePrompts.planner({
      task: input.task,
      repoSummary: input.repoSummary ?? "No repository summary provided.",
      relevantFiles: input.relevantFiles ?? "",
      plannerIndex: i,
      totalPlanners: config.planners,
      constraints: input.constraints,
    })

    const { text, sessionID } = await runAgentSession({
      parentSessionID: state.parentSessionID,
      title: `Debate planner ${i + 1} — ${state.debateID}`,
      prompt,
      model,
      agentName: "general",
      readOnly: true,
      abortSignal: input.abortSignal,
    })

    const parsed = DebatePrompts.parseArtifact<Omit<Artifact.CandidatePlan, "plannerIndex" | "sessionID">>(text)
    const plan: Artifact.CandidatePlan = {
      plannerIndex: i,
      sessionID,
      ...parsed,
    }
    Artifact.CandidatePlan.parse(plan) // validate
    return plan
  })

  state.candidatePlans = await Promise.all(plannerPromises)
  await publishPhaseComplete(state, `${state.candidatePlans.length} candidate plans produced`)
}

async function runCritiquePhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
): Promise<void> {
  if (config.critiqueRounds === 0) return
  await publishPhaseChange(state, "critique")
  log.info("debate: critique phase", { rounds: config.critiqueRounds, debateID: state.debateID })

  const model = modelForRole("critic", config, baseModel)

  for (let round = 0; round < config.critiqueRounds; round++) {
    const critiquePromises = state.candidatePlans.map(async (plan, i) => {
      const otherSummaries = state.candidatePlans
        .filter((_, j) => j !== i)
        .map((p) => DebatePrompts.summarizePlan(p))

      const prompt = DebatePrompts.critic({
        task: input.task,
        planToReview: plan,
        otherPlanSummaries: otherSummaries,
        criticIndex: i,
        constraints: input.constraints,
      })

      const { text, sessionID } = await runAgentSession({
        parentSessionID: state.parentSessionID,
        title: `Debate critic ${i + 1} (round ${round + 1}) — ${state.debateID}`,
        prompt,
        model,
        agentName: "general",
        readOnly: true,
        abortSignal: input.abortSignal,
      })

      const parsed =
        DebatePrompts.parseArtifact<Omit<Artifact.CritiqueResult, "criticIndex" | "targetPlannerIndex" | "sessionID">>(
          text,
        )
      const critique: Artifact.CritiqueResult = {
        criticIndex: i,
        targetPlannerIndex: plan.plannerIndex,
        sessionID,
        ...parsed,
      }
      Artifact.CritiqueResult.parse(critique)
      return critique
    })

    const roundResults = await Promise.all(critiquePromises)
    state.critiqueResults.push(...roundResults)
  }

  await publishPhaseComplete(state, `${state.critiqueResults.length} critique results produced`)
}

async function runJudgePhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
): Promise<void> {
  if (!config.judgeEnabled) {
    // No judge: pick the first plan as-is
    const first = state.candidatePlans[0]
    if (!first) throw new Error("No candidate plans available for judge phase")
    state.finalPlan = {
      rationale: "Judge disabled; using first candidate plan.",
      steps: first.steps,
      targetFiles: first.targetFiles,
      implementationChecklist: first.steps,
      validationChecklist: first.validationNeeds,
    }
    return
  }

  await publishPhaseChange(state, "judge")
  log.info("debate: judge phase", { debateID: state.debateID })

  const model = modelForRole("judge", config, baseModel)
  const prompt = DebatePrompts.judge({
    task: input.task,
    candidatePlans: state.candidatePlans,
    critiqueResults: state.critiqueResults,
    constraints: input.constraints,
  })

  const { text, sessionID } = await runAgentSession({
    parentSessionID: state.parentSessionID,
    title: `Debate judge — ${state.debateID}`,
    prompt,
    model,
    agentName: "general",
    readOnly: true,
    abortSignal: input.abortSignal,
  })

  const parsed = DebatePrompts.parseArtifact<Omit<Artifact.FinalPlan, "sessionID">>(text)
  state.finalPlan = Artifact.FinalPlan.parse({ sessionID, ...parsed })
  await publishPhaseComplete(state, "Final plan synthesized")
}

async function runImplementationPhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
): Promise<void> {
  if (!state.finalPlan) throw new Error("Cannot run implementation without a final plan")

  await publishPhaseChange(state, "implementation")
  log.info("debate: implementation phase", {
    strategy: config.implementationStrategy,
    implementers: config.implementers,
    debateID: state.debateID,
  })

  const model = modelForRole("implementer", config, baseModel)
  const count =
    config.implementationStrategy === "parallel" ? config.implementers : 1

  const implPromises = Array.from({ length: count }, async (_, i) => {
    const prompt = DebatePrompts.implementer({
      task: input.task,
      finalPlan: state.finalPlan!,
      relevantFileContents: input.relevantFiles ?? "No specific file context provided.",
      implementerIndex: i,
      totalImplementers: count,
    })

    const { text, sessionID } = await runAgentSession({
      parentSessionID: state.parentSessionID,
      title: `Debate implementer ${i + 1} — ${state.debateID}`,
      prompt,
      model,
      agentName: "build",
      readOnly: false,
      abortSignal: input.abortSignal,
    })

    // Try to parse JSON summary from the end of implementer output.
    // If parsing fails, synthesize a basic result.
    let parsed: Omit<Artifact.ImplementationResult, "implementerIndex" | "sessionID">
    try {
      parsed = DebatePrompts.parseArtifact(text)
    } catch {
      parsed = {
        changedFiles: state.finalPlan?.targetFiles ?? [],
        diffSummary: "Implementation complete. See session for details.",
        implementationNotes: text.slice(-500),
      }
    }

    return Artifact.ImplementationResult.parse({ implementerIndex: i, sessionID, ...parsed })
  })

  state.implementations = await Promise.all(implPromises)

  // For parallel strategy, pick the best implementation (first one for now;
  // a real compare/merge step can be added in Phase C).
  state.selectedImplementation = state.implementations[0]

  await publishPhaseComplete(
    state,
    `${state.implementations.length} implementation(s) produced. ` +
      `Changed files: ${state.selectedImplementation?.changedFiles.join(", ") || "unknown"}`,
  )
}

async function runReviewPhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
  diff: string,
  testResults: string,
): Promise<void> {
  if (!state.finalPlan || !state.selectedImplementation) return

  await publishPhaseChange(state, "review")
  log.info("debate: review phase", { reviewers: config.reviewers, debateID: state.debateID })

  const model = modelForRole("reviewer", config, baseModel)

  const reviewPromises = Array.from({ length: config.reviewers }, async (_, i) => {
    const prompt = DebatePrompts.reviewer({
      task: input.task,
      finalPlan: state.finalPlan!,
      changedFiles: state.selectedImplementation!.changedFiles,
      diff,
      testResults,
      reviewerIndex: i,
      strictness: config.reviewStrictness,
    })

    const { text, sessionID } = await runAgentSession({
      parentSessionID: state.parentSessionID,
      title: `Debate reviewer ${i + 1} — ${state.debateID}`,
      prompt,
      model,
      agentName: "general",
      readOnly: true,
      abortSignal: input.abortSignal,
    })

    const parsed = DebatePrompts.parseArtifact<
      Omit<Artifact.ReviewerResult, "reviewerIndex" | "sessionID">
    >(text)
    return Artifact.ReviewerResult.parse({ reviewerIndex: i, sessionID, ...parsed })
  })

  state.reviewerResults = await Promise.all(reviewPromises)

  const criticalCount = state.reviewerResults.flatMap((r) => r.findings.filter((f) => f.severity === "critical")).length
  await publishPhaseComplete(
    state,
    `${state.reviewerResults.length} reviewer(s) finished. Critical findings: ${criticalCount}`,
  )
}

async function runVerificationPhase(
  state: Artifact.RunState,
  input: DebateInput,
  baseModel: { providerID: string; modelID: string },
): Promise<{ result: Artifact.ValidationResult; rawOutput: string }> {
  if (!state.selectedImplementation) {
    return {
      result: { passed: false, testsRan: false, lintRan: false, typecheckRan: false, buildRan: false, summary: "No implementation to verify." },
      rawOutput: "",
    }
  }

  await publishPhaseChange(state, "verification")
  log.info("debate: verification phase", { debateID: state.debateID })

  // Ask the general agent to run the project's test/lint/typecheck/build commands.
  const verifyPrompt = [
    "You are the Verifier. Run the project's validation commands and report results.",
    "",
    "Run whatever combination of the following commands exist and are meaningful for this project:",
    "- Tests (e.g. `npm test`, `bun test`, `pytest`, etc.)",
    "- Lint (e.g. `npm run lint`, `eslint .`, etc.)",
    "- Typecheck (e.g. `npm run typecheck`, `tsc --noEmit`, `mypy`, etc.)",
    "- Build (e.g. `npm run build`, `cargo build`, etc.)",
    "",
    "Start with the cheapest/fastest checks first.",
    "If a command is not present in package.json/Makefile/etc, skip it.",
    "",
    "Changed files: " + (state.selectedImplementation?.changedFiles.join(", ") || "unknown"),
    "",
    "After running all available checks, report the results with this exact JSON:",
    "",
    "```json",
    `{
  "passed": true|false,
  "testsRan": true|false,
  "lintRan": true|false,
  "typecheckRan": true|false,
  "buildRan": true|false,
  "summary": "string",
  "failureDetails": ["string", "..."]
}`,
    "```",
  ].join("\n")

  const { text, sessionID } = await runAgentSession({
    parentSessionID: state.parentSessionID,
    title: `Debate verifier — ${state.debateID}`,
    prompt: verifyPrompt,
    model: baseModel,
    agentName: "general",
    readOnly: true,
    abortSignal: input.abortSignal,
  })

  let result: Artifact.ValidationResult
  try {
    const parsed = DebatePrompts.parseArtifact<Artifact.ValidationResult>(text)
    result = Artifact.ValidationResult.parse(parsed)
  } catch {
    // If we can't parse the JSON, make a conservative guess
    const lower = text.toLowerCase()
    const passed = !lower.includes("error") && !lower.includes("fail") && !lower.includes("failed")
    result = {
      passed,
      testsRan: lower.includes("test"),
      lintRan: lower.includes("lint"),
      typecheckRan: lower.includes("typecheck") || lower.includes("tsc"),
      buildRan: lower.includes("build"),
      summary: text.slice(0, 300),
    }
  }

  state.validationResult = { ...result, sessionID } as any

  await publishPhaseComplete(
    state,
    `Verification ${result.passed ? "passed" : "failed"}. ${result.summary}`,
  )

  return { result, rawOutput: text }
}

async function runRepairPhase(
  state: Artifact.RunState,
  input: DebateInput,
  config: DebateConfig.PipelineConfig,
  baseModel: { providerID: string; modelID: string },
  loopIndex: number,
): Promise<void> {
  if (!state.finalPlan || !state.selectedImplementation) return

  await publishPhaseChange(state, "repair")
  log.info("debate: repair loop", { loopIndex, debateID: state.debateID })

  // Collect the most important findings
  const criticalAndMajor = state.reviewerResults
    .flatMap((r) => r.findings)
    .filter((f) => f.severity === "critical" || f.severity === "major")

  const validationFailures = state.validationResult?.failureDetails ?? []

  const model = modelForRole("implementer", config, baseModel)
  const prompt = DebatePrompts.repair({
    task: input.task,
    finalPlan: state.finalPlan,
    relevantFindings: criticalAndMajor,
    validationFailures,
    changedFiles: state.selectedImplementation.changedFiles,
    fileContents: input.relevantFiles ?? "No file context provided.",
    loopIndex,
  })

  const { text, sessionID } = await runAgentSession({
    parentSessionID: state.parentSessionID,
    title: `Debate repair loop ${loopIndex + 1} — ${state.debateID}`,
    prompt,
    model,
    agentName: "build",
    readOnly: false,
    abortSignal: input.abortSignal,
  })

  let parsed: Omit<Artifact.RepairEntry, "loopIndex" | "sessionID">
  try {
    parsed = DebatePrompts.parseArtifact(text)
  } catch {
    parsed = {
      findingsAddressed: criticalAndMajor.map((f) => f.description),
      changedFiles: state.selectedImplementation.changedFiles,
      diffSummary: "Repair complete. See session for details.",
    }
  }

  const entry: Artifact.RepairEntry = Artifact.RepairEntry.parse({ loopIndex, sessionID, ...parsed })
  state.repairHistory.push(entry)

  // Update the selected implementation's changed files list
  const merged = Array.from(
    new Set([...state.selectedImplementation.changedFiles, ...entry.changedFiles]),
  )
  state.selectedImplementation = {
    ...state.selectedImplementation,
    changedFiles: merged,
    diffSummary: entry.diffSummary,
  }

  state.repairLoopCount++
  await publishPhaseComplete(state, `Repair loop ${loopIndex + 1} complete`)
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export namespace DebateOrchestrator {
  /**
   * Run the full Debate/Consensus pipeline.
   *
   * Creates child sessions under `input.parentSessionID` for each agent role.
   * Publishes Bus events at each phase transition.
   * Returns a `DebateResult` regardless of success or failure.
   */
  export async function run(input: DebateInput): Promise<Artifact.DebateResult> {
    const debateID = ulid()
    const state = Artifact.createRunState(debateID, input.parentSessionID)

    log.info("debate: starting run", {
      debateID,
      preset: input.config.preset,
      planners: input.config.planners,
      reviewers: input.config.reviewers,
    })

    // Resolve base model
    let baseModel = input.model
    if (!baseModel) {
      const defaultModel = await Provider.defaultModel().catch(() => null)
      if (!defaultModel) throw new Error("No model configured. Please set a provider API key.")
      baseModel = { providerID: defaultModel.providerID, modelID: defaultModel.modelID }
    }

    try {
      // ── Phase 1: Planning ──────────────────────────────────────────────
      await runPlanningPhase(state, input, input.config, baseModel)

      // ── Phase 2: Critique ──────────────────────────────────────────────
      await runCritiquePhase(state, input, input.config, baseModel)

      // ── Phase 3: Judge ─────────────────────────────────────────────────
      await runJudgePhase(state, input, input.config, baseModel)

      // ── Phase 4: Implementation ────────────────────────────────────────
      await runImplementationPhase(state, input, input.config, baseModel)

      // ── Phase 5–7: Review → Verify → Repair loop ──────────────────────
      if (input.config.verifierEnabled || input.config.reviewers > 0) {
        // Run initial review with empty diff (we don't have the actual diff here;
        // the reviewer will read it from the session context).
        await runReviewPhase(state, input, input.config, baseModel, "", "")

        let repairLoop = 0
        while (repairLoop < input.config.maxRepairLoops) {
          const needsRepair = shouldRepair(state, input.config)

          if (!needsRepair) break

          await runRepairPhase(state, input, input.config, baseModel, repairLoop)

          // Re-run verification after repair
          if (input.config.verifierEnabled) {
            await runVerificationPhase(state, input, baseModel)
          }

          // Re-run review after repair to check if issues are resolved
          if (repairLoop + 1 < input.config.maxRepairLoops) {
            // Reset reviewer results so we get fresh opinions
            state.reviewerResults = []
            await runReviewPhase(state, input, input.config, baseModel, "", "")
          }

          repairLoop++
        }

        // Final verification pass if not done yet
        if (input.config.verifierEnabled && state.validationResult === undefined) {
          await runVerificationPhase(state, input, baseModel)
        }
      }

      // ── Phase 8: Finalization ──────────────────────────────────────────
      await publishPhaseChange(state, "finalization")
      state.phase = "complete"

      const result = Artifact.toResult(state)

      await Bus.publish(DebateEvent.Completed, {
        debateID,
        parentSessionID: input.parentSessionID,
        result,
      })

      log.info("debate: completed", { debateID, status: result.status })
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      state.error = errorMsg
      state.phase = "failed"

      const result = Artifact.toResult(state)

      await Bus.publish(DebateEvent.Failed, {
        debateID,
        parentSessionID: input.parentSessionID,
        phase: state.phase,
        error: errorMsg,
      }).catch(() => {})

      log.error("debate: failed", { debateID, error: errorMsg })
      return result
    }
  }

  /** Determine if another repair loop is needed based on review/verification results. */
  function shouldRepair(state: Artifact.RunState, config: DebateConfig.PipelineConfig): boolean {
    // Check for critical findings in review
    const criticalFindings = state.reviewerResults.flatMap((r) =>
      r.findings.filter((f) => f.severity === "critical"),
    )
    if (criticalFindings.length > 0) return true

    // Check for request_changes assessments (in strict mode, also needs_work)
    const hasRequestChanges = state.reviewerResults.some((r) => r.overallAssessment === "request_changes")
    if (hasRequestChanges) return true

    const hasNeedsWork =
      config.reviewStrictness === "strict" &&
      state.reviewerResults.some((r) => r.overallAssessment === "needs_work")
    if (hasNeedsWork) return true

    // Check validation failures
    if (state.validationResult && !state.validationResult.passed) return true

    return false
  }
}
