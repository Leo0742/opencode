import { describe, expect, test } from "bun:test"
import { DebateConfig } from "../../src/orchestration/config"

describe("DebateConfig", () => {
  describe("presets", () => {
    test("fast preset has correct defaults", () => {
      const cfg = DebateConfig.PRESETS.fast
      expect(cfg.planners).toBe(2)
      expect(cfg.critiqueRounds).toBe(1)
      expect(cfg.judgeEnabled).toBe(true)
      expect(cfg.implementers).toBe(1)
      expect(cfg.reviewers).toBe(1)
      expect(cfg.verifierEnabled).toBe(true)
      expect(cfg.maxRepairLoops).toBe(1)
      expect(cfg.reviewStrictness).toBe("light")
    })

    test("balanced preset has correct defaults", () => {
      const cfg = DebateConfig.PRESETS.balanced
      expect(cfg.planners).toBe(3)
      expect(cfg.critiqueRounds).toBe(1)
      expect(cfg.judgeEnabled).toBe(true)
      expect(cfg.implementers).toBe(1)
      expect(cfg.reviewers).toBe(2)
      expect(cfg.verifierEnabled).toBe(true)
      expect(cfg.maxRepairLoops).toBe(2)
      expect(cfg.reviewStrictness).toBe("standard")
    })

    test("deep preset has parallel implementation", () => {
      const cfg = DebateConfig.PRESETS.deep
      expect(cfg.planners).toBe(3)
      expect(cfg.implementationStrategy).toBe("parallel")
      expect(cfg.implementers).toBe(2)
      expect(cfg.reviewers).toBe(2)
      expect(cfg.maxRepairLoops).toBe(3)
      expect(cfg.reviewStrictness).toBe("strict")
    })
  })

  describe("resolve()", () => {
    test("resolves named presets", () => {
      const balanced = DebateConfig.resolve("balanced")
      expect(balanced.preset).toBe("balanced")
      expect(balanced.planners).toBe(3)
    })

    test("overrides take precedence over preset", () => {
      const cfg = DebateConfig.resolve("balanced", { planners: 5, reviewers: 1 })
      expect(cfg.planners).toBe(5)
      expect(cfg.reviewers).toBe(1)
      // Other fields remain from preset
      expect(cfg.critiqueRounds).toBe(1)
    })

    test("custom preset uses only overrides", () => {
      const cfg = DebateConfig.resolve("custom", {
        planners: 1,
        critiqueRounds: 0,
        judgeEnabled: false,
        implementers: 1,
        reviewers: 1,
        verifierEnabled: false,
        maxRepairLoops: 0,
      })
      expect(cfg.preset).toBe("custom")
      expect(cfg.planners).toBe(1)
      expect(cfg.judgeEnabled).toBe(false)
    })
  })

  describe("guardrails — PipelineConfig.parse()", () => {
    test("rejects planners > MAX_PLANNERS", () => {
      expect(() =>
        DebateConfig.PipelineConfig.parse({
          planners: DebateConfig.MAX_PLANNERS + 1,
        }),
      ).toThrow()
    })

    test("rejects reviewers > MAX_REVIEWERS", () => {
      expect(() =>
        DebateConfig.PipelineConfig.parse({
          reviewers: DebateConfig.MAX_REVIEWERS + 1,
        }),
      ).toThrow()
    })

    test("rejects repair loops > MAX_REPAIR_LOOPS", () => {
      expect(() =>
        DebateConfig.PipelineConfig.parse({
          maxRepairLoops: DebateConfig.MAX_REPAIR_LOOPS + 1,
        }),
      ).toThrow()
    })

    test("rejects parallel strategy with implementers < 2", () => {
      expect(() =>
        DebateConfig.PipelineConfig.parse({
          implementationStrategy: "parallel",
          implementers: 1,
        }),
      ).toThrow()
    })

    test("accepts single strategy with implementers = 1", () => {
      const cfg = DebateConfig.PipelineConfig.parse({
        implementationStrategy: "single",
        implementers: 1,
      })
      expect(cfg.implementationStrategy).toBe("single")
    })

    test("applies sensible defaults", () => {
      const cfg = DebateConfig.PipelineConfig.parse({})
      expect(cfg.preset).toBe("balanced")
      expect(cfg.planners).toBe(3)
      expect(cfg.reviewers).toBe(2)
      expect(cfg.judgeEnabled).toBe(true)
      expect(cfg.verifierEnabled).toBe(true)
    })
  })
})
