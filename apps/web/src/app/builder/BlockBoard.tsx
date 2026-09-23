/**
 * @file BlockBoard
 * @description The composition board: one slot row per agent block.
 *
 * Responsibilities:
 * - Render block slots (framework / model / tools / context / prompt / reasoning / harness / decode)
 * - Report composition edits upward; hot-swap applies through the parent
 *
 * Presentation only: block availability comes from the catalog prop, never from
 * a global lookup.
 */

"use client";

import { RotateCcw } from "lucide-react";
import { UiSelect, type UiSelectEntry } from "@agentprism/ui";
import type { BuilderCatalog, BuilderComposition } from "@agentprism/client";
import { useT } from "@/i18n/useT";

export interface BlockBoardProps {
  catalog: BuilderCatalog;
  composition: BuilderComposition;
  onChange: (next: BuilderComposition) => void;
  onApplySwap: () => void;
  /** Clears the stored composition preference and resets the draft to factory defaults. */
  onRestoreDefaults: () => void;
  dirty: boolean;
  /** True while a turn is running (swap blocked) or no session is selected. */
  swapBlocked: boolean;
}

interface SlotProps {
  title: string;
  children: React.ReactNode;
}

function Slot({ title, children }: SlotProps) {
  return (
    <section className="builder-slot">
      {/* h2: the page's h1 is visually hidden in BuilderClient; styling is class-driven. */}
      <h2 className="builder-slot-title">{title}</h2>
      <div className="builder-slot-body">{children}</div>
    </section>
  );
}

/**
 * Capability-block palette: framework/endpoint/tools/reasoning pickers plus hot-swap.
 *
 * @param catalog Live block palette from the backend catalog endpoint.
 * @param composition Draft composition edited in place.
 * @param onChange Draft patch handler (marks dirty, no server round-trip yet).
 * @param onApplySwap Commits the draft as a hot-swap turn notice.
 * @param dirty Whether the draft differs from the running composition.
 * @param swapBlocked True while a turn runs or no session is selected.
 */
export function BlockBoard({ catalog, composition, onChange, onApplySwap, onRestoreDefaults, dirty, swapBlocked }: BlockBoardProps) {
  const t = useT();
  // Capability values are contract enums mirrored in both catalogs, so the dynamic
  // key is safe; the cast keeps the single dynamic-key point explicit.
  // history_mode values (minimal/tool_summary/full) collide with other blocks'
  // flat keys, so its labels live under a `history_` prefix.
  const opt = (value: string, prefix = "") => t(`builder.opts.${prefix}${value}` as Parameters<typeof t>[0]);

  const capabilityOptions = new Map<string, Array<{ value: string; label: string; description: string }>>();
  for (const group of catalog.capabilities) {
    const prefix = group.block === "history_mode" ? "history_" : "";
    capabilityOptions.set(
      group.block,
      group.options.map((option) => ({ ...option, label: opt(option.value, prefix) })),
    );
  }

  const set = (patch: Partial<BuilderComposition>) => onChange({ ...composition, ...patch });

  const toggleTool = (name: string) => {
    const tools = composition.tools.includes(name)
      ? composition.tools.filter((tool) => tool !== name)
      : [...composition.tools, name];
    set({ tools });
  };

  const endpointEntries: UiSelectEntry[] = [
    { value: "", label: t("builder.endpointDefault") },
    ...catalog.endpoints.map((endpoint) => ({ value: endpoint.id, label: endpoint.name })),
  ];

  const assembled = [
    composition.framework,
    composition.endpoint_id === "" ? t("builder.endpointDefault") : composition.endpoint_id,
    composition.tools.length > 0 ? `${t("builder.tools")}:${composition.tools.length}` : t("builder.noTools"),
    opt(composition.context),
    opt(composition.prompt_profile),
    opt(composition.reasoning),
    opt(composition.harness),
  ];

  const renderChips = (
    block: string,
    value: string,
    onSelect: (value: string) => void,
  ) => {
    const options = capabilityOptions.get(block) ?? [];
    return options.map((option) => (
      <button
        key={option.value}
        type="button"
        className="builder-chip"
        data-selected={value === option.value}
        title={option.description}
        onClick={() => onSelect(option.value)}
      >
        {option.label}
      </button>
    ));
  };

  return (
    <div className="builder-board">
      <header className="builder-board-head">
        <span className="eyebrow">{t("builder.boardTitle")}</span>
        <div className="builder-assembled">
          {assembled.map((part, index) => (
            <span key={`${part}-${index}`} className="builder-assembled-item">
              {part}
            </span>
          ))}
        </div>
        <div className="builder-board-actions">
          <button
            type="button"
            className="btn-ghost builder-restore"
            title={t("builder.restoreDefaultsTitle")}
            onClick={onRestoreDefaults}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t("builder.restoreDefaults")}
          </button>
          <button
            type="button"
            className="btn-primary builder-apply"
            disabled={!dirty || swapBlocked}
            title={swapBlocked ? t("builder.swapBlocked") : t("builder.applySwap")}
            onClick={onApplySwap}
          >
            {t("builder.applySwap")}
            {dirty ? <span className="builder-dirty-dot" aria-label={t("builder.dirty")} /> : null}
          </button>
        </div>
      </header>

      <Slot title={t("builder.slotFramework")}>
        {catalog.frameworks.map((framework) => (
          <button
            key={framework.id}
            type="button"
            className="builder-chip"
            data-selected={composition.framework === framework.id}
            disabled={framework.status === "reserved"}
            title={framework.status === "reserved" ? `${t("builder.reserved")}: ${framework.reason}` : framework.id}
            onClick={() => set({ framework: framework.id })}
          >
            {framework.name}
          </button>
        ))}
      </Slot>

      <Slot title={t("builder.slotModel")}>
        <div className="builder-row">
          <UiSelect
            value={composition.endpoint_id}
            onChange={(value) => set({ endpoint_id: value })}
            options={endpointEntries}
            ariaLabel={t("builder.slotModel")}
            className="builder-select"
          />
          <input
            className="form-input builder-model-input"
            value={composition.model_id}
            placeholder={t("builder.modelPlaceholder")}
            onChange={(event) => set({ model_id: event.target.value })}
          />
        </div>
        <div className="builder-chip-row">{renderChips("thinking", composition.thinking_level, (value) => set({ thinking_level: value as BuilderComposition["thinking_level"] }))}</div>
      </Slot>

      <Slot title={t("builder.slotTools")}>
        <div className="builder-chip-row">
          <button
            type="button"
            className="builder-chip"
            data-selected={composition.tools.length === 0}
            title={t("builder.noTools")}
            onClick={() => set({ tools: [] })}
          >
            {t("builder.noTools")}
          </button>
          {catalog.tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className="builder-chip builder-chip-tool"
              data-selected={composition.tools.includes(tool.name)}
              data-mutating={tool.mutates_workspace}
              title={`${tool.name}: ${tool.description}`}
              onClick={() => toggleTool(tool.name)}
            >
              {tool.name}
            </button>
          ))}
        </div>
      </Slot>

      <Slot title={t("builder.slotContext")}>
        <div className="builder-chip-row">{renderChips("context", composition.context, (value) => set({ context: value as BuilderComposition["context"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotPrompt")}>
        <div className="builder-chip-row">{renderChips("prompt_profile", composition.prompt_profile, (value) => set({ prompt_profile: value as BuilderComposition["prompt_profile"] }))}</div>
        <textarea
          className="form-input builder-prompt"
          rows={3}
          value={composition.system_prompt}
          placeholder={t("builder.customPromptPlaceholder")}
          onChange={(event) => set({ system_prompt: event.target.value })}
        />
      </Slot>
      <Slot title={t("builder.slotReasoning")}>
        <div className="builder-chip-row">{renderChips("reasoning", composition.reasoning, (value) => set({ reasoning: value as BuilderComposition["reasoning"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotHarness")}>
        <div className="builder-chip-row">{renderChips("harness", composition.harness, (value) => set({ harness: value as BuilderComposition["harness"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotMemory")}>
        <div className="builder-chip-row">{renderChips("memory", composition.memory, (value) => set({ memory: value as BuilderComposition["memory"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotMcp")}>
        <div className="builder-chip-row">{renderChips("mcp_policy", composition.mcp_policy, (value) => set({ mcp_policy: value as BuilderComposition["mcp_policy"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotSkill")}>
        <div className="builder-chip-row">{renderChips("skill_policy", composition.skill_policy, (value) => set({ skill_policy: value as BuilderComposition["skill_policy"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotOrchestration")}>
        <div className="builder-chip-row">{renderChips("orchestration", composition.orchestration, (value) => set({ orchestration: value as BuilderComposition["orchestration"] }))}</div>
      </Slot>
      <Slot title={t("builder.slotHistoryMode")}>
        <div className="builder-chip-row">{renderChips("history_mode", composition.history_mode, (value) => set({ history_mode: value as BuilderComposition["history_mode"] }))}</div>
      </Slot>

      <Slot title={t("builder.slotDecode")}>
        <div className="builder-decode">
          <label>
            <span>{t("builder.temperature")}</span>
            <input
              type="number" min={0} max={2} step={0.1}
              className="form-input builder-num"
              value={composition.temperature}
              onChange={(event) => set({ temperature: finiteOr(event.target.value, composition.temperature) })}
            />
          </label>
          <label>
            <span>{t("builder.topP")}</span>
            <input
              type="number" min={0} max={1} step={0.05}
              className="form-input builder-num"
              value={composition.top_p}
              onChange={(event) => set({ top_p: finiteOr(event.target.value, composition.top_p) })}
            />
          </label>
          <label>
            <span>{t("builder.maxTokens")}</span>
            <input
              type="number" min={64} max={384000} step={64}
              className="form-input builder-num"
              value={composition.max_output_tokens}
              onChange={(event) => set({ max_output_tokens: finiteOr(event.target.value, composition.max_output_tokens) })}
            />
          </label>
          <label>
            <span>{t("builder.maxSteps")}</span>
            <input
              type="number" min={1} step={1}
              className="form-input builder-num"
              value={composition.max_steps}
              onChange={(event) => set({ max_steps: Math.max(1, finiteOr(event.target.value, composition.max_steps)) })}
            />
          </label>
          <label>
            <span>{t("builder.freqPenalty")}</span>
            <input
              type="number" min={-2} max={2} step={0.1}
              className="form-input builder-num"
              value={composition.frequency_penalty}
              onChange={(event) => set({ frequency_penalty: finiteOr(event.target.value, composition.frequency_penalty) })}
            />
          </label>
          <label>
            <span>{t("builder.presencePenalty")}</span>
            <input
              type="number" min={-2} max={2} step={0.1}
              className="form-input builder-num"
              value={composition.presence_penalty}
              onChange={(event) => set({ presence_penalty: finiteOr(event.target.value, composition.presence_penalty) })}
            />
          </label>
        </div>
      </Slot>
    </div>
  );
}

/** Parses a numeric field; non-numeric or empty input keeps the previous value. */
export function finiteOr(raw: string, fallback: number): number {
  if (!raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
