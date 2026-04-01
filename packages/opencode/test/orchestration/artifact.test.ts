import { describe, expect, test } from "bun:test"
import { Artifact } from "../../src/orchestration/artifact"

describe("Artifact", () => {
  describe("createRunState()", () => {
    test("initialises with planning phase", () => {
      const state = Artifact.createRunState("debateID", "sessionID")
      expect(state.debateID).toBe("debateID")
      expect(state.parentSessionID).toBe("sessionID")
      expect(state.phase).toBe("planning")
      expect(state.candidatePlans).toHaveLength(0)
      expect(state.critiqueResults).toHaveLength(0)
      expect(state.implementations).toHaveLength(0)
      expect(state.repairHistory).toHaveLength(0)
      expect(state.repairLoopCount).toBe(0)
    })
  })

  describe("toResult()", () => {
    test("returns success when no error and validation passed", () => {
      const state = Artifact.createRunState("d1", "s1")
      state.phase = "complete"
      state.validationResult = {
        passed: true,
        testsRan: true,
        lintRan: false,
        typecheckRan: false,
        buildRan: false,
        summary: "All tests passed",
      }
      const result = Artifact.toResult(state)
      expect(result.status).toBe("success")
    })

    test("returns failed when error is set", () => {
      const state = Artifact.createRunState("d2", "s2")
      state.error = "LLM call failed"
      state.phase = "failed"
      const result = Artifact.toResult(state)
      expect(result.status).toBe("failed")
      expect(result.error).toBe("LLM call failed")
    })

    test("returns partial_success when validation failed", () => {
      const state = Artifact.createRunState("d3", "s3")
      state.phase = "complete"
      state.validationResult = {
        passed: false,
        testsRan: true,
        lintRan: false,
        typecheckRan: false,
        buildRan: false,
        summary: "Tests failed",
        failureDetails: ["test A failed"],
      }
      const result = Artifact.toResult(state)
      expect(result.status).toBe("partial_success")
    })

    test("returns partial_success when critical reviewer findings exist", () => {
      const state = Artifact.createRunState("d4", "s4")
      state.phase = "complete"
      state.validationResult = {
        passed: true,
        testsRan: true,
        lintRan: false,
        typecheckRan: false,
        buildRan: false,
        summary: "OK",
      }
      state.reviewerResults = [
        {
          reviewerIndex: 0,
          findings: [{ severity: "critical", description: "Null pointer dereference" }],
          potentialRegressions: [],
          architectureConcerns: [],
          overallAssessment: "request_changes",
        },
      ]
      const result = Artifact.toResult(state)
      expect(result.status).toBe("partial_success")
    })

    test("maps state fields to result correctly", () => {
      const state = Artifact.createRunState("dX", "sX")
      state.phase = "complete"
      state.repairLoopCount = 2
      state.repairHistory = [
        {
          loopIndex: 0,
          sessionID: "repair-s1",
          findingsAddressed: ["bug A"],
          changedFiles: ["foo.ts"],
          diffSummary: "Fixed bug A",
        },
      ]
      const result = Artifact.toResult(state)
      expect(result.debateID).toBe("dX")
      expect(result.parentSessionID).toBe("sX")
      expect(result.totalRepairLoops).toBe(2)
      expect(result.repairHistory).toHaveLength(1)
      expect(result.allImplementations).toEqual(state.implementations)
    })
  })

  describe("Zod schemas — round-trip", () => {
    test("CandidatePlan validates correctly", () => {
      const plan = Artifact.CandidatePlan.parse({
        plannerIndex: 0,
        interpretation: "Add dark mode",
        steps: ["Update CSS variables", "Add toggle button"],
        targetFiles: ["theme.css", "settings.tsx"],
        risks: ["Might break existing themes"],
        validationNeeds: ["Visual regression test"],
      })
      expect(plan.plannerIndex).toBe(0)
      expect(plan.steps).toHaveLength(2)
    })

    test("ValidationResult validates correctly", () => {
      const result = Artifact.ValidationResult.parse({
        passed: true,
        testsRan: true,
        lintRan: true,
        typecheckRan: true,
        buildRan: false,
        summary: "Tests and lint passed",
      })
      expect(result.passed).toBe(true)
      expect(result.buildRan).toBe(false)
    })

    test("ReviewerResult rejects invalid severity", () => {
      expect(() =>
        Artifact.ReviewerResult.parse({
          reviewerIndex: 0,
          findings: [{ severity: "catastrophic", description: "bad" }],
          potentialRegressions: [],
          architectureConcerns: [],
          overallAssessment: "approve",
        }),
      ).toThrow()
    })
  })
})
