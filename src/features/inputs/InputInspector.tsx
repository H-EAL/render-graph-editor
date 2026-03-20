/**
 * InputInspector — center panel of the Input Editor.
 *
 * Shows all editable properties of the selected InputDefinition:
 *   Basic · Type · Default Value · Constraints · Organization · Flags · Conditions · Dependencies
 */

import { useState } from "react";
import type { InputDefinition, InputId, InputKind, InputCondition } from "../../types";
import { ConditionBuilder } from "./ConditionBuilder";
import { buildDependsOn, buildUsedBy, buildInputPassUsage } from "../../utils/inputCondition";
import { useStore } from "../../state/store";

// ─── Shared styles ────────────────────────────────────────────────────────────

const LABEL = "text-[10px] font-semibold text-zinc-500 uppercase tracking-wider shrink-0 w-24";
const FIELD = "bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-zinc-500 w-full";
const ROW = "flex items-start gap-3 py-1";
const SECTION = "border-b border-zinc-800 pb-3 mb-3";

const INPUT_KINDS: InputKind[] = [
    "bool", "int", "float", "enum", "color", "vec2", "vec3", "vec4", "texture", "buffer",
];

// ─── Default value editors ────────────────────────────────────────────────────

function DefaultValueEditor({
    def,
    onChange,
}: {
    def: InputDefinition;
    onChange: (v: unknown) => void;
}) {
    const val = def.defaultValue;

    if (def.kind === "bool") {
        return (
            <select
                value={String(val)}
                onChange={(e) => onChange(e.target.value === "true")}
                className={FIELD}
            >
                <option value="true">true</option>
                <option value="false">false</option>
            </select>
        );
    }

    if (def.kind === "int") {
        return (
            <input
                type="number"
                value={val as number}
                step={1}
                min={def.min}
                max={def.max}
                onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
                className={`${FIELD} font-mono`}
            />
        );
    }

    if (def.kind === "float") {
        return (
            <input
                type="number"
                value={val as number}
                step={def.step ?? "any"}
                min={def.min}
                max={def.max}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className={`${FIELD} font-mono`}
            />
        );
    }

    if (def.kind === "enum") {
        if (!def.enumOptions?.length)
            return <span className="text-[10px] text-zinc-600 italic">Add enum options first</span>;
        return (
            <select
                value={val as string}
                onChange={(e) => onChange(e.target.value)}
                className={FIELD}
            >
                {def.enumOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        );
    }

    if (def.kind === "color") {
        const arr = (val as number[] | undefined) ?? [1, 1, 1, 1];
        return (
            <div className="flex items-center gap-1">
                {["R", "G", "B", "A"].map((ch, i) => (
                    <label key={ch} className="flex items-center gap-0.5">
                        <span className="text-[9px] text-zinc-600">{ch}</span>
                        <input
                            type="number"
                            value={arr[i] ?? 1}
                            step={0.01}
                            min={0}
                            max={1}
                            onChange={(e) => {
                                const next = [...arr];
                                next[i] = parseFloat(e.target.value) || 0;
                                onChange(next);
                            }}
                            className="w-14 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none font-mono"
                        />
                    </label>
                ))}
            </div>
        );
    }

    if (def.kind === "vec2" || def.kind === "vec3" || def.kind === "vec4") {
        const n = def.kind === "vec2" ? 2 : def.kind === "vec3" ? 3 : 4;
        const arr = (val as number[] | undefined) ?? Array(n).fill(0);
        const labels = ["X", "Y", "Z", "W"].slice(0, n);
        return (
            <div className="flex items-center gap-1">
                {labels.map((ch, i) => (
                    <label key={ch} className="flex items-center gap-0.5">
                        <span className="text-[9px] text-zinc-600">{ch}</span>
                        <input
                            type="number"
                            value={arr[i] ?? 0}
                            step="any"
                            onChange={(e) => {
                                const next = [...arr];
                                next[i] = parseFloat(e.target.value) || 0;
                                onChange(next);
                            }}
                            className="w-16 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-1 focus:outline-none font-mono"
                        />
                    </label>
                ))}
            </div>
        );
    }

    // texture / buffer → resource ID text
    return (
        <input
            type="text"
            value={val as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder="resource id…"
            className={`${FIELD} font-mono`}
        />
    );
}

// ─── Enum options editor ──────────────────────────────────────────────────────

function EnumOptionsEditor({
    options,
    onChange,
}: {
    options: { value: string; label: string }[];
    onChange: (opts: { value: string; label: string }[]) => void;
}) {
    return (
        <div className="flex flex-col gap-1 w-full">
            {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1">
                    <input
                        type="text"
                        value={opt.value}
                        onChange={(e) => {
                            const next = [...options];
                            next[i] = { ...opt, value: e.target.value };
                            onChange(next);
                        }}
                        placeholder="value"
                        className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-0.5 focus:outline-none font-mono"
                    />
                    <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                            const next = [...options];
                            next[i] = { ...opt, label: e.target.value };
                            onChange(next);
                        }}
                        placeholder="label"
                        className="flex-1 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-1.5 py-0.5 focus:outline-none"
                    />
                    <button
                        onClick={() => onChange(options.filter((_, j) => j !== i))}
                        className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
                    >
                        ✕
                    </button>
                </div>
            ))}
            <button
                onClick={() => onChange([...options, { value: "", label: "" }])}
                className="text-[10px] text-zinc-500 hover:text-zinc-200 border border-dashed border-zinc-700/50 rounded px-2 py-0.5 hover:border-zinc-600 transition-colors self-start"
            >
                + option
            </button>
        </div>
    );
}

// ─── CategoryPath breadcrumb editor ──────────────────────────────────────────

function CategoryPathEditor({
    path,
    onChange,
}: {
    path: string[];
    onChange: (p: string[]) => void;
}) {
    const [adding, setAdding] = useState(false);
    const [newSeg, setNewSeg] = useState("");

    const commitAdd = () => {
        const t = newSeg.trim();
        if (t) onChange([...path, t]);
        setAdding(false);
        setNewSeg("");
    };

    return (
        <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
            {path.map((seg, i) => (
                <div key={i} className="flex items-center gap-0.5">
                    {i > 0 && <span className="text-zinc-700 text-[10px]">›</span>}
                    <span className="flex items-center gap-0.5 bg-zinc-800 border border-zinc-700/50 rounded px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {seg}
                        <button
                            onClick={() => onChange(path.filter((_, j) => j !== i))}
                            className="text-zinc-600 hover:text-red-400 text-[9px] leading-none ml-0.5"
                        >
                            ✕
                        </button>
                    </span>
                </div>
            ))}
            {adding ? (
                <input
                    autoFocus
                    type="text"
                    value={newSeg}
                    onChange={(e) => setNewSeg(e.target.value)}
                    onBlur={commitAdd}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitAdd();
                        if (e.key === "Escape") { setAdding(false); setNewSeg(""); }
                    }}
                    className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 w-24 focus:outline-none"
                    placeholder="Category…"
                />
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    className="text-[9px] text-zinc-600 hover:text-zinc-300 border border-dashed border-zinc-700/50 rounded px-1.5 py-0.5 hover:border-zinc-600 transition-colors"
                >
                    + segment
                </button>
            )}
        </div>
    );
}

// ─── Dependency display ───────────────────────────────────────────────────────

function DependencyInfo({
    defId,
    definitions,
}: {
    defId: InputId;
    definitions: InputDefinition[];
}) {
    const pipeline = useStore((s) => s.pipeline);
    const resources = useStore((s) => s.resources);
    const dependsOn = buildDependsOn(definitions).get(defId) ?? new Set<InputId>();
    const usedBy = buildUsedBy(definitions).get(defId) ?? new Set<InputId>();
    const usedInPasses = buildInputPassUsage(defId, pipeline, resources);
    const labelOf = (id: InputId) => definitions.find((d) => d.id === id)?.label ?? id;

    if (dependsOn.size === 0 && usedBy.size === 0 && usedInPasses.length === 0) return null;

    return (
        <div className="flex flex-col gap-1.5 text-[10px]">
            {usedInPasses.length > 0 && (
                <div className="flex items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Passes:</span>
                    <span className="text-zinc-300 flex flex-wrap gap-1">
                        {usedInPasses.map((p) => (
                            <span key={p.id} className="bg-blue-900/30 border border-blue-800/40 rounded px-1.5 py-0.5 text-[9px] text-blue-300">
                                {p.name}
                            </span>
                        ))}
                    </span>
                </div>
            )}
            {dependsOn.size > 0 && (
                <div className="flex items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Depends on:</span>
                    <span className="text-zinc-300 flex flex-wrap gap-1">
                        {[...dependsOn].map((id) => (
                            <span key={id} className="bg-zinc-800 rounded px-1.5 py-0.5 text-[9px]">
                                {labelOf(id)}
                            </span>
                        ))}
                    </span>
                </div>
            )}
            {usedBy.size > 0 && (
                <div className="flex items-start gap-2">
                    <span className="text-zinc-500 shrink-0">Used by:</span>
                    <span className="text-zinc-300 flex flex-wrap gap-1">
                        {[...usedBy].map((id) => (
                            <span key={id} className="bg-amber-900/30 border border-amber-800/40 rounded px-1.5 py-0.5 text-[9px] text-amber-300">
                                {labelOf(id)}
                            </span>
                        ))}
                    </span>
                </div>
            )}
        </div>
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface InputInspectorProps {
    definition: InputDefinition;
    definitions: InputDefinition[];
    onChange: (patch: Partial<InputDefinition>) => void;
}

export function InputInspector({ definition: def, definitions, onChange }: InputInspectorProps) {
    const u = (patch: Partial<InputDefinition>) => onChange(patch);

    const isNumeric = def.kind === "int" || def.kind === "float";

    return (
        <div className="flex flex-col overflow-y-auto h-full">
            <div className="px-4 py-3 flex flex-col gap-0">

                {/* ── Basic ───────────────────────────────────────────────── */}
                <div className={SECTION}>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Basic</div>
                    <div className={ROW}>
                        <span className={LABEL}>Label</span>
                        <input
                            type="text"
                            value={def.label}
                            onChange={(e) => u({ label: e.target.value })}
                            className={FIELD}
                        />
                    </div>
                    <div className={ROW}>
                        <span className={LABEL}>ID</span>
                        <span className="text-[11px] font-mono text-zinc-500 py-1 select-all">{def.id}</span>
                    </div>
                    <div className={ROW}>
                        <span className={LABEL}>Description</span>
                        <textarea
                            value={def.description ?? ""}
                            onChange={(e) => u({ description: e.target.value || undefined })}
                            rows={2}
                            className={`${FIELD} resize-y`}
                            placeholder="Optional description…"
                        />
                    </div>
                </div>

                {/* ── Type ────────────────────────────────────────────────── */}
                <div className={SECTION}>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Type</div>
                    <div className={ROW}>
                        <span className={LABEL}>Kind</span>
                        <select
                            value={def.kind}
                            onChange={(e) => u({ kind: e.target.value as InputKind, defaultValue: undefined })}
                            className={FIELD}
                        >
                            {INPUT_KINDS.map((k) => (
                                <option key={k} value={k}>{k}</option>
                            ))}
                        </select>
                    </div>
                    <div className={ROW}>
                        <span className={LABEL}>Default</span>
                        <div className="flex-1 min-w-0">
                            <DefaultValueEditor def={def} onChange={(v) => u({ defaultValue: v })} />
                        </div>
                    </div>
                    {def.kind === "enum" && (
                        <div className={ROW}>
                            <span className={LABEL}>Options</span>
                            <div className="flex-1">
                                <EnumOptionsEditor
                                    options={def.enumOptions ?? []}
                                    onChange={(opts) => u({ enumOptions: opts })}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Constraints ─────────────────────────────────────────── */}
                {isNumeric && (
                    <div className={SECTION}>
                        <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Constraints</div>
                        <div className={ROW}>
                            <span className={LABEL}>Min</span>
                            <input
                                type="number"
                                value={def.min ?? ""}
                                step="any"
                                placeholder="—"
                                onChange={(e) => u({ min: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                                className={`${FIELD} font-mono`}
                            />
                        </div>
                        <div className={ROW}>
                            <span className={LABEL}>Max</span>
                            <input
                                type="number"
                                value={def.max ?? ""}
                                step="any"
                                placeholder="—"
                                onChange={(e) => u({ max: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                                className={`${FIELD} font-mono`}
                            />
                        </div>
                        <div className={ROW}>
                            <span className={LABEL}>Step</span>
                            <input
                                type="number"
                                value={def.step ?? ""}
                                step="any"
                                placeholder="—"
                                onChange={(e) => u({ step: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                                className={`${FIELD} font-mono`}
                            />
                        </div>
                    </div>
                )}

                {/* ── Organization ────────────────────────────────────────── */}
                <div className={SECTION}>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Organization</div>
                    <div className={ROW}>
                        <span className={LABEL}>Category</span>
                        <div className="flex-1">
                            <CategoryPathEditor
                                path={def.categoryPath}
                                onChange={(p) => u({ categoryPath: p })}
                            />
                        </div>
                    </div>
                    <div className={ROW}>
                        <span className={LABEL}>Section</span>
                        <input
                            type="text"
                            value={def.section ?? ""}
                            onChange={(e) => u({ section: e.target.value || undefined })}
                            placeholder="—"
                            className={FIELD}
                        />
                    </div>
                    <div className={ROW}>
                        <span className={LABEL}>Order</span>
                        <input
                            type="number"
                            value={def.order ?? ""}
                            step={1}
                            placeholder="—"
                            onChange={(e) => u({ order: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                            className={`${FIELD} font-mono`}
                        />
                    </div>
                </div>

                {/* ── Flags ────────────────────────────────────────────────── */}
                <div className={SECTION}>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Flags</div>
                    <label className="flex items-center gap-2 cursor-pointer" title="Hidden by default in the form">
                        <input
                            type="checkbox"
                            checked={!!def.advanced}
                            onChange={(e) => u({ advanced: e.target.checked })}
                            className="rounded accent-blue-500"
                        />
                        <span className="text-[11px] text-zinc-300">Advanced</span>
                        <span className="text-[10px] text-zinc-600">Hidden by default in the form</span>
                    </label>
                </div>

                {/* ── Conditions ───────────────────────────────────────────── */}
                <div className={SECTION}>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3">Conditions</div>
                    <div className="flex flex-col gap-4">
                        <ConditionBuilder
                            label="Visibility"
                            value={def.visibilityCondition}
                            onChange={(c) => u({ visibilityCondition: c as InputCondition | undefined })}
                            definitions={definitions.filter((d) => d.id !== def.id)}
                        />
                        <ConditionBuilder
                            label="Enabled"
                            value={def.enabledCondition}
                            onChange={(c) => u({ enabledCondition: c as InputCondition | undefined })}
                            definitions={definitions.filter((d) => d.id !== def.id)}
                        />
                    </div>
                </div>

                {/* ── Dependencies ─────────────────────────────────────────── */}
                <div className="pb-3">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Dependencies</div>
                    <DependencyInfo defId={def.id} definitions={definitions} />
                </div>

            </div>
        </div>
    );
}
