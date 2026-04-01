import { describe, expect, test } from "bun:test"
import { DebatePrompts } from "../../src/orchestration/prompts"
import type { Artifact } from "../../src/orchestration/artifact"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TASK = "Add dark mode support to the settings panel"
const REPO_SUMMARY = "TypeScript monorepo with SolidJS frontend"
const PLAN: Artifact.CandidatePlan = {
  plannerIndex: 0,
  interpretation: "Add CSS variables and a toggle button",
  steps: ["Create theme.css", "Update settings.tsx", "Add toggle"],
  targetFiles: ["theme.css", "settings.tsx"],
  risks: ["Break existing styles"],
  validationNeeds: ["Visual regression"],
}
const FINAL_PLAN: Artifact.FinalPlan = {
  rationale: "Best merged plan",
  steps: ["Create theme.css", "Update settings.tsx"],
  targetFiles: ["theme.css", "settings.tsx"],
  implementationChecklist: ["Create theme.css", "Update settings.tsx"],
  validationChecklist: ["Run visual regression tests"],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DebatePrompts", () => {
  describe("planner()", () => {
    test("includes task and repo summary", () => {
      const prompt = DebatePrompts.planner({
        task: TASK,
        repoSummary: REPO_SUMMARY,
        relevantFiles: "theme.css — CSS variables file",
        plannerIndex: 0,
        totalPlanners: 3,
      })
      expect(prompt).toContain(TASK)
      expect(prompt).toContain(REPO_SUMMARY)
      expect(prompt).toContain("Planner 1 of 3")
    })

    test("includes output schema with required fields", () => {
      const prompt = DebatePrompts.planner({
        task: TASK,
        repoSummary: REPO_SUMMARY,
        relevantFiles: "",
        plannerIndex: 1,
        totalPlanners: 2,
      })
      expect(prompt).toContain("interpretation")
      expect(prompt).toContain("steps")
      expect(prompt).toContain("targetFiles")
      expect(prompt).toContain("risks")
      expect(prompt).toContain("validationNeeds")
    })

    test("includes constraints when provided", () => {
      const prompt = DebatePrompts.planner({
        task: TASK,
        repoSummary: REPO_SUMMARY,
        relevantFiles: "",
        plannerIndex: 0,
        totalPlanners: 1,
        constraints: ["Must be backwards compatible", "No new dependencies"],
      })
      expect(prompt).toContain("Must be backwards compatible")
      expect(prompt).toContain("No new dependencies")
    })
  })

  describe("critic()", () => {
    test("includes task and plan under review", () => {
      const prompt = DebatePrompts.critic({
        task: TASK,
        planToReview: PLAN,
        otherPlanSummaries: [],
        criticIndex: 0,
      })
      expect(prompt).toContain(TASK)
      expect(prompt).toContain("Critic 1")
      expect(prompt).toContain("interpretation")
    })

    test("includes other plan summaries when provided", () => {
      const prompt = DebatePrompts.critic({
        task: TASK,
        planToReview: PLAN,
        otherPlanSummaries: ["Other plan summary 1"],
        criticIndex: 0,
      })
      expect(prompt).toContain("Other plan summary 1")
    })

    test("includes output schema", () => {
      const prompt = DebatePrompts.critic({
        task: TASK,
        planToReview: PLAN,
        otherPlanSummaries: [],
        criticIndex: 0,
      })
      expect(prompt).toContain("weaknesses")
      expect(prompt).toContain("missedCases")
      expect(prompt).toContain("betterAlternatives")
      expect(prompt).toContain("confidenceNotes")
    })
  })

  describe("judge()", () => {
    test("includes all candidate plans and critiques", () => {
      const critique: Artifact.CritiqueResult = {
        criticIndex: 0,
        targetPlannerIndex: 0,
        weaknesses: ["Missing error handling"],
        missedCases: [],
        betterAlternatives: [],
        confidenceNotes: "High confidence",
      }
      const prompt = DebatePrompts.judge({
        task: TASK,
        candidatePlans: [PLAN],
        critiqueResults: [critique],
      })
      expect(prompt).toContain(TASK)
      expect(prompt).toContain("Judge")
      expect(prompt).toContain("Missing error handling")
      expect(prompt).toContain("rationale")
      expect(prompt).toContain("implementationChecklist")
    })
  })

  describe("implementer()", () => {
    test("includes final plan and task", () => {
      const prompt = DebatePrompts.implementer({
        task: TASK,
        finalPlan: FINAL_PLAN,
        relevantFileContents: "// theme.css content",
        implementerIndex: 0,
        totalImplementers: 1,
      })
      expect(prompt).toContain(TASK)
      expect(prompt).toContain("Implementer 1 of 1")
      expect(prompt).toContain("changedFiles")
      expect(prompt).toContain("diffSummary")
    })
  })

  describe("reviewer()", () => {
    test("includes diff and final plan", () => {
      const prompt = DebatePrompts.reviewer({
        task: TASK,
        finalPlan: FINAL_PLAN,
        changedFiles: ["theme.css"],
        diff: "+.dark { --bg: #000; }",
        testResults: "All tests passed",
        reviewerIndex: 0,
        strictness: "standard",
      })
      expect(prompt).toContain(TASK)
      expect(prompt).toContain("Reviewer 1")
      expect(prompt).toContain("+.dark { --bg: #000; }")
      expect(prompt).toContain("All tests passed")
    })

    test("light strictness has different instructions than strict", () => {
      const light = DebatePrompts.reviewer({
        task: TASK,
        finalPlan: FINAL_PLAN,
        changedFiles: [],
        diff: "",
        testResults: "",
        reviewerIndex: 0,
        strictness: "light",
      })
      const strict = DebatePrompts.reviewer({
        task: TASK,
        finalPlan: FINAL_PLAN,
        changedFiles: [],
        diff: "",
        testResults: "",
        reviewerIndex: 0,
        strictness: "strict",
      })
      expect(light).not.toBe(strict)
    })
  })

  describe("repair()", () => {
    test("includes findings to fix", () => {
      const prompt = DebatePrompts.repair({
        task: TASK,
        finalPlan: FINAL_PLAN,
        relevantFindings: [{ severity: "critical", description: "Null pointer" }],
        validationFailures: ["TypeError: cannot read undefined"],
        changedFiles: ["settings.tsx"],
        fileContents: "// settings content",
        loopIndex: 0,
      })
      expect(prompt).toContain("Repair Agent (loop 1)")
      expect(prompt).toContain("Null pointer")
      expect(prompt).toContain("TypeError: cannot read undefined")
    })
  })

  describe("summarizePlan()", () => {
    test("returns compact summary string", () => {
      const summary = DebatePrompts.summarizePlan(PLAN)
      expect(summary).toContain("Planner 1")
      expect(summary).toContain("Add CSS variables")
      expect(summary).toContain("theme.css")
    })
  })

  describe("parseArtifact()", () => {
    test("parses JSON inside ```json fence", () => {
      const text = 'Some prose\n```json\n{"key": "value", "num": 42}\n```\nMore prose'
      const result = DebatePrompts.parseArtifact<{ key: string; num: number }>(text)
      expect(result.key).toBe("value")
      expect(result.num).toBe(42)
    })

    test("parses raw JSON without fence as fallback", () => {
      const text = 'Result: {"steps": ["a", "b"]}'
      const result = DebatePrompts.parseArtifact<{ steps: string[] }>(text)
      expect(result.steps).toEqual(["a", "b"])
    })

    test("throws when no JSON found", () => {
      const text = "This is just plain text with no JSON at all"
      expect(() => DebatePrompts.parseArtifact(text)).toThrow()
    })

    test("handles nested JSON objects", () => {
      const text = '```json\n{"a": {"b": [1, 2, 3]}}\n```'
      const result = DebatePrompts.parseArtifact<{ a: { b: number[] } }>(text)
      expect(result.a.b).toEqual([1, 2, 3])
    })
  })
})
