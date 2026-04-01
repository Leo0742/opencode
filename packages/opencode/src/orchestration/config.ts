import z from "zod"

/**
 * Pipeline configuration for the Debate/Consensus workflow.
 *
 * Each run consists of these phases:
 *   1. Planning   – N independent planners produce candidate plans
 *   2. Critique   – critics review the candidate plans (0–2 rounds)
 *   3. Judge      – synthesizer picks/merges the best final plan
 *   4. Implement  – 1–3 implementers write code from the plan
 *   5. Review     – reviewers examine the resulting diff/tests
 *   6. Verify     – real test/lint/build validation
 *   7. Repair     – repair loop (up to maxRepairLoops)
 *   8. Finalize   – collect and return all artifacts
 */

export namespace DebateConfig {
  // ─── Guardrails ──────────────────────────────────────────────────────────

  export const MAX_PLANNERS = 5
  export const MAX_IMPLEMENTERS = 3
  export const MAX_REVIEWERS = 4
  export const MAX_CRITIQUE_ROUNDS = 2
  export const MAX_REPAIR_LOOPS = 3

  // ─── Schemas ─────────────────────────────────────────────────────────────

  export const ModelRef = z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional()

  export const ImplementationStrategy = z.enum(["single", "parallel"])
  export type ImplementationStrategy = z.infer<typeof ImplementationStrategy>

  export const ReviewStrictness = z.enum(["light", "standard", "strict"])
  export type ReviewStrictness = z.infer<typeof ReviewStrictness>

  export const Preset = z.enum(["fast", "balanced", "deep", "custom"])
  export type Preset = z.infer<typeof Preset>

  /** Full pipeline configuration. All counts are validated by the refine at the bottom. */
  export const PipelineConfig = z
    .object({
      preset: Preset.default("balanced"),

      // Phase 1 – Planning
      planners: z.number().int().min(1).max(MAX_PLANNERS).default(3),

      // Phase 2 – Critique
      critiqueRounds: z.number().int().min(0).max(MAX_CRITIQUE_ROUNDS).default(1),

      // Phase 3 – Judge
      judgeEnabled: z.boolean().default(true),

      // Phase 4 – Implementation
      implementationStrategy: ImplementationStrategy.default("single"),
      implementers: z.number().int().min(1).max(MAX_IMPLEMENTERS).default(1),

      // Phase 5 – Review
      reviewers: z.number().int().min(1).max(MAX_REVIEWERS).default(2),

      // Phase 6 – Verification
      verifierEnabled: z.boolean().default(true),

      // Phase 7 – Repair
      maxRepairLoops: z.number().int().min(0).max(MAX_REPAIR_LOOPS).default(2),

      // Review strictness for phase 5
      reviewStrictness: ReviewStrictness.default("standard"),

      // Per-role model overrides (optional; fall back to session model if absent)
      models: z
        .object({
          planner: ModelRef,
          critic: ModelRef,
          judge: ModelRef,
          implementer: ModelRef,
          reviewer: ModelRef,
        })
        .partial()
        .default({}),
    })
    .refine(
      (cfg) => {
        if (cfg.implementationStrategy === "parallel" && cfg.implementers < 2) return false
        return true
      },
      { message: "parallel implementation strategy requires implementers >= 2" },
    )

  export type PipelineConfig = z.infer<typeof PipelineConfig>

  // ─── Built-in presets ────────────────────────────────────────────────────

  export const PRESETS: Record<Exclude<Preset, "custom">, PipelineConfig> = {
    fast: PipelineConfig.parse({
      preset: "fast",
      planners: 2,
      critiqueRounds: 1,
      judgeEnabled: true,
      implementationStrategy: "single",
      implementers: 1,
      reviewers: 1,
      verifierEnabled: true,
      maxRepairLoops: 1,
      reviewStrictness: "light",
    }),

    balanced: PipelineConfig.parse({
      preset: "balanced",
      planners: 3,
      critiqueRounds: 1,
      judgeEnabled: true,
      implementationStrategy: "single",
      implementers: 1,
      reviewers: 2,
      verifierEnabled: true,
      maxRepairLoops: 2,
      reviewStrictness: "standard",
    }),

    deep: PipelineConfig.parse({
      preset: "deep",
      planners: 3,
      critiqueRounds: 1,
      judgeEnabled: true,
      implementationStrategy: "parallel",
      implementers: 2,
      reviewers: 2,
      verifierEnabled: true,
      maxRepairLoops: 3,
      reviewStrictness: "strict",
    }),
  }

  /** Resolve a preset into a full config, optionally overriding individual fields. */
  export function resolve(preset: Preset, overrides?: Partial<PipelineConfig>): PipelineConfig {
    if (preset === "custom") {
      return PipelineConfig.parse({ preset: "custom", ...overrides })
    }
    return PipelineConfig.parse({ ...PRESETS[preset], ...overrides })
  }
}
