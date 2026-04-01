# Debate / Consensus Workflow

A built-in multi-model pipeline that runs independent planning, structured critique, synthesis, implementation, review, verification, and repair — all wired to OpenCode's existing agent/session/bus infrastructure.

## Pipeline Phases

```
Planners (N) → Critics → Judge → Implementer(s) → Reviewers → Verifier → Repair loops
```

1. **Planning** — N independent planner agents produce `CandidatePlan` artifacts (interpretation, steps, target files, risks, validation needs).
2. **Critique** — Each planner's plan is reviewed by a critic agent. Critics see the competing plans in summary form to encourage comparative feedback.
3. **Judge synthesis** — A single judge reads all plans and critiques and produces a `FinalPlan` with an implementation checklist and validation checklist.
4. **Implementation** — One or more implementer agents execute the final plan. With `parallel` strategy, multiple implementers work concurrently; the first to complete is used.
5. **Review** — N reviewer agents examine the diff, changed files, and test output against the final plan. They produce structured `ReviewerResult` artifacts with severity-tagged findings.
6. **Verification** — The verifier runs tests, lint, and build and produces a `ValidationResult`.
7. **Repair loops** — If reviewers found critical issues or validation failed, a repair agent addresses them. Repeats up to `maxRepairLoops` times.
8. **Finalization** — Final `DebateResult` is assembled and returned.

## Presets

| Preset   | Planners | Critique rounds | Reviewers | Strategy | Max repairs | Strictness |
|----------|----------|-----------------|-----------|----------|-------------|------------|
| fast     | 2        | 1               | 1         | single   | 1           | light      |
| balanced | 3        | 1               | 2         | single   | 2           | standard   |
| deep     | 3        | 1               | 2         | parallel | 3           | strict     |
| custom   | 1–5      | 0–2             | 1–4       | any      | 0–3         | any        |

## Guardrails

- Max planners: 5
- Max implementers: 3
- Max reviewers: 4
- Max critique rounds: 2
- Max repair loops: 3
- Parallel strategy requires ≥ 2 implementers

## Usage

### Slash command

In the session input, type `/debate` to open the configuration dialog. Choose a preset or configure custom settings, then click **Run Debate**.

### HTTP API

```http
POST /session/:sessionID/debate
Content-Type: application/json

{
  "task": "Add dark mode to the settings panel",
  "preset": "balanced",
  "config": {
    "planners": 3,
    "critiqueRounds": 1,
    "judgeEnabled": true,
    "implementationStrategy": "single",
    "implementers": 1,
    "reviewers": 2,
    "verifierEnabled": true,
    "maxRepairLoops": 2,
    "reviewStrictness": "standard"
  }
}
```

Response (streamed, JSON):

```json
{
  "debateID": "debate_abc123",
  "parentSessionID": "session_xyz",
  "status": "success",
  "finalPlan": { ... },
  "allImplementations": [ ... ],
  "reviewerResults": [ ... ],
  "validationResult": { ... },
  "totalRepairLoops": 0,
  "repairHistory": []
}
```

Status values: `"success"`, `"partial_success"`, `"failed"`.

`partial_success` means implementation completed but either validation failed or reviewers found critical issues that repair loops could not fully resolve.

### Config file

Add a `debate` section to `opencode.json` to set project-level defaults:

```json
{
  "debate": {
    "preset": "balanced",
    "planners": 3,
    "critique_rounds": 1,
    "judge_enabled": true,
    "implementation_strategy": "single",
    "implementers": 1,
    "reviewers": 2,
    "verifier_enabled": true,
    "max_repair_loops": 2,
    "review_strictness": "standard"
  }
}
```

## Architecture

Each pipeline phase creates a child session via `Session.create({ parentID })` and runs it through `SessionPrompt.prompt()`. Phases communicate via compact structured JSON artifacts — not raw transcripts — to stay within context limits. All phases are run inside the same Effect runtime and share the existing provider/model infrastructure.

Bus events are published at each phase transition:

- `debate.PhaseChanged` — emitted when a phase starts
- `debate.PhaseCompleted` — emitted when a phase finishes with its artifact
- `debate.Completed` — emitted with the final `DebateResult`
- `debate.Failed` — emitted on unrecoverable error

### Key files

| File | Purpose |
|------|---------|
| `packages/opencode/src/orchestration/config.ts` | Zod schema, presets, guardrails, `resolve()` |
| `packages/opencode/src/orchestration/artifact.ts` | All artifact types, `RunState`, `toResult()` |
| `packages/opencode/src/orchestration/prompts.ts` | Prompt builders for each agent role, `parseArtifact()` |
| `packages/opencode/src/orchestration/orchestrator.ts` | State machine, Bus events, `DebateOrchestrator.run()` |
| `packages/opencode/src/orchestration/index.ts` | Re-exports |
| `packages/opencode/src/server/routes/session.ts` | `POST /:sessionID/debate` route |
| `packages/app/src/components/dialog-debate.tsx` | Configuration dialog (UI) |
| `packages/app/src/pages/session/debate-panel.tsx` | Results display panel (UI) |
| `packages/opencode/test/orchestration/` | Unit tests (config, artifact, prompts) |
