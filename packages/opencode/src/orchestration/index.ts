/**
 * Debate / Consensus orchestration system.
 *
 * This module implements a phase-based multi-model pipeline that:
 * 1. Runs multiple independent planners to produce candidate plans
 * 2. Runs critics to find weaknesses in each plan
 * 3. Runs a judge to synthesize the best final plan
 * 4. Runs one or more implementers to write code
 * 5. Runs reviewers to examine the resulting changes
 * 6. Runs a verifier (real tests/lint/build)
 * 7. Runs repair loops if issues are found
 *
 * Usage:
 *   import { DebateOrchestrator, DebateConfig } from "@/orchestration"
 *
 *   const result = await DebateOrchestrator.run({
 *     task: "Add dark mode support to the settings panel",
 *     parentSessionID: session.id,
 *     config: DebateConfig.resolve("balanced"),
 *     model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
 *   })
 */

export { DebateConfig } from "./config"
export { Artifact } from "./artifact"
export { DebatePrompts } from "./prompts"
export { DebateOrchestrator, DebateEvent, type DebateInput } from "./orchestrator"
