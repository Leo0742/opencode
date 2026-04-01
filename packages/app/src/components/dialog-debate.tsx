/**
 * Debate / Consensus workflow dialog.
 *
 * Lets the user configure and launch a multi-model pipeline run:
 * planners → critics → judge → implementer(s) → reviewers → verifier → repair loops
 */

import {
  type Component,
  createSignal,
  createMemo,
  Show,
  For,
} from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"

// ─── Types (mirrored from orchestration/config.ts) ───────────────────────────

type Preset = "fast" | "balanced" | "deep" | "custom"
type Strategy = "single" | "parallel"
type Strictness = "light" | "standard" | "strict"

interface DebateConfig {
  preset: Preset
  planners: number
  critiqueRounds: number
  judgeEnabled: boolean
  implementationStrategy: Strategy
  implementers: number
  reviewers: number
  verifierEnabled: boolean
  maxRepairLoops: number
  reviewStrictness: Strictness
}

const PRESETS: Record<Exclude<Preset, "custom">, DebateConfig> = {
  fast: {
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
  },
  balanced: {
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
  },
  deep: {
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
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DialogDebateProps {
  sessionID: string
  task: string
  onClose?: () => void
  onStarted?: (debateID: string) => void
}

export const DialogDebate: Component<DialogDebateProps> = (props) => {
  const sdk = useSDK()
  const server = useServer()
  const language = useLanguage()

  const [preset, setPreset] = createSignal<Preset>("balanced")
  const [custom, setCustom] = createSignal<DebateConfig>({ ...PRESETS.balanced, preset: "custom" })
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const config = createMemo<DebateConfig>(() => {
    const p = preset()
    if (p === "custom") return custom()
    return PRESETS[p]
  })

  const presetDescriptions: Record<Preset, string> = {
    fast: "2 planners · 1 critique · 1 reviewer · 1 repair loop",
    balanced: "3 planners · 1 critique · 2 reviewers · 2 repair loops (default)",
    deep: "3 planners · 1 critique · 2 reviewers · parallel implementation · 3 repair loops",
    custom: "Configure each parameter manually",
  }

  async function run() {
    setRunning(true)
    setError(undefined)

    try {
      const conn = server.current
      if (!conn) throw new Error("No server connection")

      const baseUrl = conn.http.url.replace(/\/+$/, "")
      const dir = sdk.directory ? encodeURIComponent(sdk.directory) : ""
      const url = `${baseUrl}/session/${props.sessionID}/debate`

      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (conn.http.password) {
        headers["Authorization"] = `Basic ${btoa(`${conn.http.username ?? "opencode"}:${conn.http.password}`)}`
      }
      if (sdk.directory) {
        headers["x-opencode-directory"] = dir
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          task: props.task,
          preset: config().preset,
          config: config(),
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`Debate run failed: ${text}`)
      }

      const result = await res.json()
      props.onStarted?.(result.debateID ?? "")
      props.onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog size="large" transition>
      <div class="flex flex-col gap-5 p-6">
        {/* Header */}
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-tint">
            <Icon name="brain" class="text-primary" />
          </div>
          <div>
            <div class="text-16-medium text-text">Debate / Consensus</div>
            <div class="text-13-regular text-text-weak">Multi-model planning, implementation, and review</div>
          </div>
        </div>

        {/* Task preview */}
        <div class="bg-surface-2 rounded-lg px-4 py-3">
          <div class="text-11-medium text-text-weak uppercase tracking-wide mb-1">Task</div>
          <div class="text-14-regular text-text line-clamp-3">{props.task || "(no task text)"}</div>
        </div>

        {/* Preset selection */}
        <div class="flex flex-col gap-2">
          <div class="text-13-medium text-text">Preset</div>
          <div class="grid grid-cols-2 gap-2">
            <For each={["fast", "balanced", "deep", "custom"] as Preset[]}>
              {(p) => (
                <button
                  class={[
                    "flex flex-col gap-1 p-3 rounded-lg border text-left transition-colors",
                    preset() === p
                      ? "border-primary bg-primary-tint text-primary"
                      : "border-border bg-surface hover:border-border-strong text-text",
                  ].join(" ")}
                  onClick={() => {
                    setPreset(p)
                    if (p !== "custom") setCustom({ ...PRESETS[p as Exclude<Preset, "custom">], preset: "custom" })
                  }}
                >
                  <span class="text-13-medium capitalize">{p}</span>
                  <span class="text-11-regular text-text-weak">{presetDescriptions[p]}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Custom settings */}
        <Show when={preset() === "custom"}>
          <div class="flex flex-col gap-3 border border-border rounded-lg p-4">
            <div class="text-13-medium text-text">Custom settings</div>
            <div class="grid grid-cols-2 gap-4">
              <NumberField
                label="Planners"
                value={custom().planners}
                min={1}
                max={5}
                onChange={(v) => setCustom((c) => ({ ...c, planners: v }))}
              />
              <NumberField
                label="Critique rounds"
                value={custom().critiqueRounds}
                min={0}
                max={2}
                onChange={(v) => setCustom((c) => ({ ...c, critiqueRounds: v }))}
              />
              <NumberField
                label="Reviewers"
                value={custom().reviewers}
                min={1}
                max={4}
                onChange={(v) => setCustom((c) => ({ ...c, reviewers: v }))}
              />
              <NumberField
                label="Max repair loops"
                value={custom().maxRepairLoops}
                min={0}
                max={3}
                onChange={(v) => setCustom((c) => ({ ...c, maxRepairLoops: v }))}
              />
            </div>

            {/* Implementation strategy */}
            <div class="flex flex-col gap-1">
              <label class="text-12-medium text-text-weak">Implementation strategy</label>
              <div class="flex gap-2">
                <For each={["single", "parallel"] as Strategy[]}>
                  {(s) => (
                    <button
                      class={[
                        "px-3 py-1.5 rounded text-13-medium border transition-colors",
                        custom().implementationStrategy === s
                          ? "border-primary bg-primary-tint text-primary"
                          : "border-border bg-surface text-text hover:border-border-strong",
                      ].join(" ")}
                      onClick={() => setCustom((c) => ({ ...c, implementationStrategy: s }))}
                    >
                      {s}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <Show when={custom().implementationStrategy === "parallel"}>
              <NumberField
                label="Implementers (parallel)"
                value={custom().implementers}
                min={2}
                max={3}
                onChange={(v) => setCustom((c) => ({ ...c, implementers: v }))}
              />
            </Show>

            {/* Review strictness */}
            <div class="flex flex-col gap-1">
              <label class="text-12-medium text-text-weak">Review strictness</label>
              <div class="flex gap-2">
                <For each={["light", "standard", "strict"] as Strictness[]}>
                  {(s) => (
                    <button
                      class={[
                        "px-3 py-1.5 rounded text-13-medium border transition-colors",
                        custom().reviewStrictness === s
                          ? "border-primary bg-primary-tint text-primary"
                          : "border-border bg-surface text-text hover:border-border-strong",
                      ].join(" ")}
                      onClick={() => setCustom((c) => ({ ...c, reviewStrictness: s }))}
                    >
                      {s}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Toggles */}
            <div class="flex gap-4">
              <Toggle
                label="Judge enabled"
                value={custom().judgeEnabled}
                onChange={(v) => setCustom((c) => ({ ...c, judgeEnabled: v }))}
              />
              <Toggle
                label="Verifier enabled"
                value={custom().verifierEnabled}
                onChange={(v) => setCustom((c) => ({ ...c, verifierEnabled: v }))}
              />
            </div>
          </div>
        </Show>

        {/* Pipeline summary */}
        <Show when={preset() !== "custom"}>
          <PipelineSummary config={config()} />
        </Show>

        {/* Error */}
        <Show when={error()}>
          <div class="bg-red-tint border border-red rounded-lg px-4 py-3 text-13-regular text-red">{error()}</div>
        </Show>

        {/* Actions */}
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onClose} disabled={running()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={running()}>
            <Show when={running()} fallback={<><Icon name="brain" />Run Debate</>}>
              Running…
            </Show>
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ─── Small helper components ──────────────────────────────────────────────────

function NumberField(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div class="flex flex-col gap-1">
      <label class="text-12-medium text-text-weak">{props.label}</label>
      <div class="flex items-center gap-2">
        <button
          class="w-7 h-7 flex items-center justify-center rounded border border-border bg-surface hover:border-border-strong text-text disabled:opacity-40"
          onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
          disabled={props.value <= props.min}
        >
          –
        </button>
        <span class="w-6 text-center text-14-medium text-text">{props.value}</span>
        <button
          class="w-7 h-7 flex items-center justify-center rounded border border-border bg-surface hover:border-border-strong text-text disabled:opacity-40"
          onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
          disabled={props.value >= props.max}
        >
          +
        </button>
      </div>
    </div>
  )
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      class={[
        "flex items-center gap-2 px-3 py-1.5 rounded border text-13-medium transition-colors",
        props.value
          ? "border-primary bg-primary-tint text-primary"
          : "border-border bg-surface text-text-weak hover:border-border-strong",
      ].join(" ")}
      onClick={() => props.onChange(!props.value)}
    >
      <span
        class={[
          "w-3 h-3 rounded-full border",
          props.value ? "bg-primary border-primary" : "bg-transparent border-text-weak",
        ].join(" ")}
      />
      {props.label}
    </button>
  )
}

function PipelineSummary(props: { config: DebateConfig }) {
  const stages = [
    { label: `${props.config.planners} Planners`, icon: "list" },
    ...(props.config.critiqueRounds > 0
      ? [{ label: `${props.config.critiqueRounds} Critique round${props.config.critiqueRounds > 1 ? "s" : ""}`, icon: "eye" }]
      : []),
    ...(props.config.judgeEnabled ? [{ label: "Judge synthesis", icon: "check" }] : []),
    {
      label: props.config.implementationStrategy === "parallel"
        ? `${props.config.implementers} Implementers (parallel)`
        : "Implementer",
      icon: "code",
    },
    { label: `${props.config.reviewers} Reviewer${props.config.reviewers > 1 ? "s" : ""}`, icon: "magnifier" },
    ...(props.config.verifierEnabled ? [{ label: "Verifier (tests/lint/build)", icon: "terminal" }] : []),
    ...(props.config.maxRepairLoops > 0
      ? [{ label: `Up to ${props.config.maxRepairLoops} repair loop${props.config.maxRepairLoops > 1 ? "s" : ""}`, icon: "refresh" }]
      : []),
  ]

  return (
    <div class="flex flex-col gap-1.5">
      <div class="text-12-medium text-text-weak uppercase tracking-wide">Pipeline</div>
      <div class="flex flex-wrap gap-1.5">
        <For each={stages}>
          {(stage, i) => (
            <>
              <div class="flex items-center gap-1 px-2 py-1 bg-surface-2 rounded text-12-regular text-text-weak border border-border">
                <span>{stage.label}</span>
              </div>
              <Show when={i() < stages.length - 1}>
                <span class="text-text-weak self-center text-12-regular">→</span>
              </Show>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
