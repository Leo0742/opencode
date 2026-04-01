/**
 * Debate / Consensus results panel.
 *
 * Displays structured artifacts from a completed debate run:
 * - Phase pipeline status
 * - Candidate plans
 * - Critique findings
 * - Final plan
 * - Implementation result
 * - Reviewer findings
 * - Validation result
 * - Repair history
 */

import {
  type Component,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Collapsible } from "@opencode-ai/ui/collapsible"

// ─── Types (mirrors packages/opencode/src/orchestration/artifact.ts) ─────────

type DebatePhase =
  | "planning"
  | "critique"
  | "judge"
  | "implementation"
  | "review"
  | "verification"
  | "repair"
  | "finalization"
  | "complete"
  | "failed"

interface CandidatePlan {
  plannerIndex: number
  interpretation: string
  steps: string[]
  targetFiles: string[]
  risks: string[]
  validationNeeds: string[]
}

interface CritiqueResult {
  criticIndex: number
  targetPlannerIndex: number
  weaknesses: string[]
  missedCases: string[]
  betterAlternatives: string[]
  confidenceNotes: string
}

interface FinalPlan {
  rationale: string
  steps: string[]
  targetFiles: string[]
  implementationChecklist: string[]
  validationChecklist: string[]
}

interface ImplementationResult {
  implementerIndex: number
  changedFiles: string[]
  diffSummary: string
  implementationNotes?: string
}

type Severity = "critical" | "major" | "minor" | "info"
interface ReviewFinding {
  severity: Severity
  file?: string
  description: string
  suggestedFix?: string
}

interface ReviewerResult {
  reviewerIndex: number
  findings: ReviewFinding[]
  potentialRegressions: string[]
  architectureConcerns: string[]
  overallAssessment: "approve" | "request_changes" | "needs_work"
}

interface ValidationResult {
  passed: boolean
  testsRan: boolean
  lintRan: boolean
  typecheckRan: boolean
  buildRan: boolean
  summary: string
  failureDetails?: string[]
}

interface RepairEntry {
  loopIndex: number
  findingsAddressed: string[]
  changedFiles: string[]
  diffSummary: string
}

interface DebateResult {
  debateID: string
  parentSessionID: string
  status: "success" | "partial_success" | "failed"
  phase: DebatePhase
  candidatePlans: CandidatePlan[]
  critiqueResults: CritiqueResult[]
  finalPlan?: FinalPlan
  selectedImplementation?: ImplementationResult
  allImplementations: ImplementationResult[]
  reviewerResults: ReviewerResult[]
  validationResult?: ValidationResult
  repairHistory: RepairEntry[]
  totalRepairLoops: number
  error?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

const PHASE_ORDER: DebatePhase[] = [
  "planning",
  "critique",
  "judge",
  "implementation",
  "review",
  "verification",
  "repair",
  "finalization",
]

const PHASE_LABELS: Record<DebatePhase, string> = {
  planning: "Planning",
  critique: "Critique",
  judge: "Judge",
  implementation: "Implementation",
  review: "Review",
  verification: "Verification",
  repair: "Repair",
  finalization: "Finalizing",
  complete: "Complete",
  failed: "Failed",
}

function phaseStatus(currentPhase: DebatePhase, checkPhase: DebatePhase): "done" | "active" | "pending" | "failed" {
  if (currentPhase === "failed") return checkPhase === currentPhase ? "failed" : "done"
  if (currentPhase === "complete") return "done"
  const cur = PHASE_ORDER.indexOf(currentPhase)
  const chk = PHASE_ORDER.indexOf(checkPhase)
  if (cur < 0) return "done"
  if (chk < cur) return "done"
  if (chk === cur) return "active"
  return "pending"
}

export const DebatePanel: Component<{ result: DebateResult }> = (props) => {
  const [expanded, setExpanded] = createSignal<string | null>("overview")

  const criticalCount = createMemo(
    () =>
      props.result.reviewerResults.flatMap((r) => r.findings.filter((f) => f.severity === "critical")).length,
  )

  return (
    <div class="flex flex-col gap-4 p-4 text-14-regular text-text">
      {/* Status banner */}
      <div
        class={[
          "flex items-center gap-3 px-4 py-3 rounded-lg border",
          props.result.status === "success"
            ? "bg-green-tint border-green text-green"
            : props.result.status === "partial_success"
              ? "bg-yellow-tint border-yellow text-yellow"
              : "bg-red-tint border-red text-red",
        ].join(" ")}
      >
        <Icon
          name={
            props.result.status === "success"
              ? "check"
              : props.result.status === "partial_success"
                ? "warning"
                : "close"
          }
        />
        <div>
          <div class="text-14-medium capitalize">{props.result.status.replace("_", " ")}</div>
          <Show when={props.result.error}>
            <div class="text-12-regular mt-0.5">{props.result.error}</div>
          </Show>
        </div>
      </div>

      {/* Phase timeline */}
      <div class="flex flex-col gap-1">
        <div class="text-12-medium text-text-weak uppercase tracking-wide mb-1">Pipeline</div>
        <div class="flex items-center gap-1 flex-wrap">
          <For each={PHASE_ORDER}>
            {(phase, i) => {
              const status = createMemo(() => phaseStatus(props.result.phase, phase))
              return (
                <>
                  <div
                    class={[
                      "flex items-center gap-1 px-2.5 py-1 rounded-full text-12-medium border",
                      status() === "done"
                        ? "bg-green-tint border-green text-green"
                        : status() === "active"
                          ? "bg-primary-tint border-primary text-primary animate-pulse"
                          : status() === "failed"
                            ? "bg-red-tint border-red text-red"
                            : "bg-surface border-border text-text-weak",
                    ].join(" ")}
                  >
                    <Show when={status() === "done"}>
                      <span class="text-10">✓</span>
                    </Show>
                    <Show when={status() === "failed"}>
                      <span class="text-10">✗</span>
                    </Show>
                    {PHASE_LABELS[phase]}
                  </div>
                  <Show when={i() < PHASE_ORDER.length - 1}>
                    <span class="text-text-weak text-12">→</span>
                  </Show>
                </>
              )
            }}
          </For>
        </div>
      </div>

      {/* Candidate Plans */}
      <Show when={props.result.candidatePlans.length > 0}>
        <DebateSection
          id="plans"
          title={`Candidate Plans (${props.result.candidatePlans.length})`}
          expanded={expanded()}
          onToggle={setExpanded}
        >
          <div class="flex flex-col gap-3">
            <For each={props.result.candidatePlans}>
              {(plan) => (
                <div class="border border-border rounded-lg overflow-hidden">
                  <div class="bg-surface-2 px-3 py-2 text-13-medium text-text border-b border-border">
                    Planner {plan.plannerIndex + 1}
                  </div>
                  <div class="p-3 flex flex-col gap-2">
                    <p class="text-13-regular text-text-weak italic">{plan.interpretation}</p>
                    <StringList label="Steps" items={plan.steps} />
                    <StringList label="Target files" items={plan.targetFiles} mono />
                    <Show when={plan.risks.length > 0}>
                      <StringList label="Risks" items={plan.risks} color="yellow" />
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </DebateSection>
      </Show>

      {/* Critique Results */}
      <Show when={props.result.critiqueResults.length > 0}>
        <DebateSection
          id="critiques"
          title={`Critiques (${props.result.critiqueResults.length})`}
          expanded={expanded()}
          onToggle={setExpanded}
        >
          <div class="flex flex-col gap-3">
            <For each={props.result.critiqueResults}>
              {(critique) => (
                <div class="border border-border rounded-lg overflow-hidden">
                  <div class="bg-surface-2 px-3 py-2 text-13-medium text-text border-b border-border">
                    Critic {critique.criticIndex + 1} → Plan {critique.targetPlannerIndex + 1}
                  </div>
                  <div class="p-3 flex flex-col gap-2">
                    <Show when={critique.weaknesses.length > 0}>
                      <StringList label="Weaknesses" items={critique.weaknesses} color="red" />
                    </Show>
                    <Show when={critique.missedCases.length > 0}>
                      <StringList label="Missed cases" items={critique.missedCases} color="yellow" />
                    </Show>
                    <Show when={critique.betterAlternatives.length > 0}>
                      <StringList label="Better alternatives" items={critique.betterAlternatives} />
                    </Show>
                    <Show when={critique.confidenceNotes}>
                      <div class="text-12-regular text-text-weak italic">{critique.confidenceNotes}</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </DebateSection>
      </Show>

      {/* Final Plan */}
      <Show when={props.result.finalPlan}>
        {(plan) => (
          <DebateSection
            id="final-plan"
            title="Final Plan"
            expanded={expanded()}
            onToggle={setExpanded}
          >
            <div class="flex flex-col gap-3">
              <p class="text-13-regular text-text-weak italic">{plan().rationale}</p>
              <StringList label="Steps" items={plan().steps} />
              <StringList label="Target files" items={plan().targetFiles} mono />
              <StringList label="Implementation checklist" items={plan().implementationChecklist} />
              <StringList label="Validation checklist" items={plan().validationChecklist} />
            </div>
          </DebateSection>
        )}
      </Show>

      {/* Implementation */}
      <Show when={props.result.selectedImplementation}>
        {(impl) => (
          <DebateSection
            id="implementation"
            title="Implementation"
            expanded={expanded()}
            onToggle={setExpanded}
          >
            <div class="flex flex-col gap-2">
              <p class="text-13-regular text-text">{impl().diffSummary}</p>
              <StringList label="Changed files" items={impl().changedFiles} mono />
              <Show when={impl().implementationNotes}>
                <div class="text-12-regular text-text-weak">{impl().implementationNotes}</div>
              </Show>
            </div>
          </DebateSection>
        )}
      </Show>

      {/* Review findings */}
      <Show when={props.result.reviewerResults.length > 0}>
        <DebateSection
          id="review"
          title={`Review (${props.result.reviewerResults.length} reviewer${props.result.reviewerResults.length > 1 ? "s" : ""}${criticalCount() > 0 ? ` · ${criticalCount()} critical` : ""})`}
          expanded={expanded()}
          onToggle={setExpanded}
        >
          <div class="flex flex-col gap-3">
            <For each={props.result.reviewerResults}>
              {(reviewer) => (
                <div class="border border-border rounded-lg overflow-hidden">
                  <div
                    class={[
                      "flex items-center justify-between px-3 py-2 border-b border-border text-13-medium",
                      reviewer.overallAssessment === "approve"
                        ? "bg-green-tint text-green"
                        : reviewer.overallAssessment === "request_changes"
                          ? "bg-red-tint text-red"
                          : "bg-yellow-tint text-yellow",
                    ].join(" ")}
                  >
                    <span>Reviewer {reviewer.reviewerIndex + 1}</span>
                    <span class="capitalize text-12-regular">{reviewer.overallAssessment.replace("_", " ")}</span>
                  </div>
                  <div class="p-3 flex flex-col gap-2">
                    <Show when={reviewer.findings.length > 0}>
                      <div class="flex flex-col gap-1.5">
                        <For each={reviewer.findings}>
                          {(finding) => (
                            <div
                              class={[
                                "flex items-start gap-2 px-2 py-1.5 rounded text-12-regular",
                                finding.severity === "critical"
                                  ? "bg-red-tint text-red"
                                  : finding.severity === "major"
                                    ? "bg-orange-tint text-orange"
                                    : finding.severity === "minor"
                                      ? "bg-yellow-tint text-yellow"
                                      : "bg-surface-2 text-text-weak",
                              ].join(" ")}
                            >
                              <span class="uppercase text-10 font-medium shrink-0 mt-0.5">{finding.severity}</span>
                              <div>
                                <span>{finding.description}</span>
                                <Show when={finding.file}>
                                  <span class="ml-1 font-mono text-11 opacity-70">{finding.file}</span>
                                </Show>
                                <Show when={finding.suggestedFix}>
                                  <div class="mt-1 text-11 opacity-80">{finding.suggestedFix}</div>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={reviewer.potentialRegressions.length > 0}>
                      <StringList label="Potential regressions" items={reviewer.potentialRegressions} color="yellow" />
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </DebateSection>
      </Show>

      {/* Validation */}
      <Show when={props.result.validationResult}>
        {(v) => (
          <DebateSection
            id="validation"
            title={`Verification — ${v().passed ? "Passed" : "Failed"}`}
            expanded={expanded()}
            onToggle={setExpanded}
          >
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap gap-2">
                <ValidationBadge label="Tests" ran={v().testsRan} />
                <ValidationBadge label="Lint" ran={v().lintRan} />
                <ValidationBadge label="Typecheck" ran={v().typecheckRan} />
                <ValidationBadge label="Build" ran={v().buildRan} />
              </div>
              <p class="text-13-regular text-text">{v().summary}</p>
              <Show when={(v().failureDetails?.length ?? 0) > 0}>
                <StringList label="Failures" items={v().failureDetails ?? []} color="red" mono />
              </Show>
            </div>
          </DebateSection>
        )}
      </Show>

      {/* Repair history */}
      <Show when={props.result.repairHistory.length > 0}>
        <DebateSection
          id="repair"
          title={`Repair History (${props.result.repairHistory.length} loop${props.result.repairHistory.length > 1 ? "s" : ""})`}
          expanded={expanded()}
          onToggle={setExpanded}
        >
          <div class="flex flex-col gap-2">
            <For each={props.result.repairHistory}>
              {(entry) => (
                <div class="border border-border rounded p-3 flex flex-col gap-1.5">
                  <div class="text-12-medium text-text-weak">Loop {entry.loopIndex + 1}</div>
                  <p class="text-13-regular text-text">{entry.diffSummary}</p>
                  <StringList label="Changed" items={entry.changedFiles} mono />
                </div>
              )}
            </For>
          </div>
        </DebateSection>
      </Show>
    </div>
  )
}

// ─── Section helper ───────────────────────────────────────────────────────────

function DebateSection(props: {
  id: string
  title: string
  expanded: string | null
  onToggle: (id: string | null) => void
  children: any
}) {
  const isOpen = createMemo(() => props.expanded === props.id)
  return (
    <div class="border border-border rounded-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-4 py-2.5 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
        onClick={() => props.onToggle(isOpen() ? null : props.id)}
      >
        <span class="text-13-medium text-text">{props.title}</span>
        <Icon
          name="chevron-down"
          class={["text-text-weak transition-transform", isOpen() ? "rotate-180" : ""].join(" ")}
        />
      </button>
      <Show when={isOpen()}>
        <div class="p-4">{props.children}</div>
      </Show>
    </div>
  )
}

function StringList(props: {
  label: string
  items: string[]
  mono?: boolean
  color?: "red" | "yellow" | "green"
}) {
  if (props.items.length === 0) return null
  return (
    <div class="flex flex-col gap-1">
      <div class="text-11-medium text-text-weak uppercase tracking-wide">{props.label}</div>
      <ul class="flex flex-col gap-0.5">
        <For each={props.items}>
          {(item) => (
            <li
              class={[
                "flex items-start gap-1.5 text-12-regular",
                props.color === "red"
                  ? "text-red"
                  : props.color === "yellow"
                    ? "text-yellow"
                    : "text-text",
                props.mono ? "font-mono" : "",
              ].join(" ")}
            >
              <span class="text-text-weak shrink-0 mt-0.5">•</span>
              {item}
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

function ValidationBadge(props: { label: string; ran: boolean }) {
  return (
    <div
      class={[
        "flex items-center gap-1 px-2 py-0.5 rounded-full text-11-medium border",
        props.ran
          ? "bg-green-tint border-green text-green"
          : "bg-surface border-border text-text-weak",
      ].join(" ")}
    >
      <Show when={props.ran}><span>✓</span></Show>
      {props.label}
    </div>
  )
}
