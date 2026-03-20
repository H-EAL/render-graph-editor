/**
 * InputPreview — right panel of the Input Editor.
 *
 * Renders a live simulation of the end-user form.
 * Inputs are grouped by categoryPath. Conditions are evaluated in real time
 * against a local "preview state" that the author can toggle.
 */

import { useState, useMemo } from "react";
import type { InputDefinition, InputId } from "../../types";
import { evaluateCondition, buildUsedBy } from "../../utils/inputCondition";

// ─── Preview state init ───────────────────────────────────────────────────────

function initPreviewState(definitions: InputDefinition[]): Record<InputId, unknown> {
    const state: Record<InputId, unknown> = {};
    for (const def of definitions) state[def.id] = def.defaultValue;
    return state;
}

// ─── Form controls ────────────────────────────────────────────────────────────

const CTL = "bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-zinc-500 w-full";

function PreviewControl({
    def,
    value,
    disabled,
    onChange,
}: {
    def: InputDefinition;
    value: unknown;
    disabled: boolean;
    onChange: (v: unknown) => void;
}) {
    const cls = `${CTL} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`;

    if (def.kind === "bool") {
        return (
            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={!!value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                    className="rounded accent-blue-500 w-4 h-4"
                />
                <span className={`text-[11px] ${disabled ? "text-zinc-600" : "text-zinc-300"}`}>
                    {value ? "true" : "false"}
                </span>
            </label>
        );
    }

    if (def.kind === "int") {
        return (
            <input
                type="number"
                value={value as number}
                step={def.step ?? 1}
                min={def.min}
                max={def.max}
                disabled={disabled}
                onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
                className={`${cls} font-mono`}
            />
        );
    }

    if (def.kind === "float") {
        return (
            <input
                type="number"
                value={value as number}
                step={def.step ?? "any"}
                min={def.min}
                max={def.max}
                disabled={disabled}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className={`${cls} font-mono`}
            />
        );
    }

    if (def.kind === "enum") {
        return (
            <select
                value={value as string}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                className={cls}
            >
                {(def.enumOptions ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        );
    }

    if (def.kind === "color") {
        const arr = (value as number[] | undefined) ?? [1, 1, 1, 1];
        // Show a color swatch + rgba inputs
        const hex = `#${arr
            .slice(0, 3)
            .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
                .toString(16)
                .padStart(2, "0"))
            .join("")}`;
        return (
            <div className="flex items-center gap-1.5">
                <div
                    className="w-6 h-6 rounded border border-zinc-700 shrink-0"
                    style={{ background: hex }}
                />
                <div className="flex gap-0.5">
                    {["R", "G", "B", "A"].map((ch, i) => (
                        <label key={ch} className="flex items-center gap-0.5">
                            <span className="text-[9px] text-zinc-600">{ch}</span>
                            <input
                                type="number"
                                value={(arr[i] ?? 1).toFixed(2)}
                                step={0.01}
                                min={0}
                                max={1}
                                disabled={disabled}
                                onChange={(e) => {
                                    const next = [...arr];
                                    next[i] = parseFloat(e.target.value) || 0;
                                    onChange(next);
                                }}
                                className="w-12 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[10px] rounded px-1 py-0.5 focus:outline-none font-mono"
                            />
                        </label>
                    ))}
                </div>
            </div>
        );
    }

    if (def.kind === "vec2" || def.kind === "vec3" || def.kind === "vec4") {
        const n = def.kind === "vec2" ? 2 : def.kind === "vec3" ? 3 : 4;
        const arr = (value as number[] | undefined) ?? Array(n).fill(0);
        const labels = ["X", "Y", "Z", "W"].slice(0, n);
        return (
            <div className="flex gap-0.5">
                {labels.map((ch, i) => (
                    <label key={ch} className="flex items-center gap-0.5">
                        <span className="text-[9px] text-zinc-600">{ch}</span>
                        <input
                            type="number"
                            value={arr[i] ?? 0}
                            step="any"
                            disabled={disabled}
                            onChange={(e) => {
                                const next = [...arr];
                                next[i] = parseFloat(e.target.value) || 0;
                                onChange(next);
                            }}
                            className="w-14 bg-zinc-800 border border-zinc-700/60 text-zinc-200 text-[10px] rounded px-1.5 py-0.5 focus:outline-none font-mono"
                        />
                    </label>
                ))}
            </div>
        );
    }

    // texture / buffer
    return (
        <input
            type="text"
            value={value as string}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`${cls} font-mono`}
            placeholder="resource id…"
        />
    );
}

// ─── Category group renderer ──────────────────────────────────────────────────

function PreviewCategory({
    name,
    children,
    depth,
}: {
    name: string;
    children: React.ReactNode;
    depth: number;
}) {
    const [collapsed, setCollapsed] = useState(false);
    return (
        <div className={depth === 0 ? "mb-3" : "mb-1 ml-3"}>
            <button
                onClick={() => setCollapsed((v) => !v)}
                className="flex items-center gap-1.5 w-full text-left py-0.5 group"
            >
                <span className="text-[9px] text-zinc-600 group-hover:text-zinc-400 transition-colors">
                    {collapsed ? "▶" : "▼"}
                </span>
                <span
                    className={`font-semibold uppercase tracking-wider ${
                        depth === 0
                            ? "text-[10px] text-zinc-400"
                            : "text-[9px] text-zinc-500"
                    }`}
                >
                    {name}
                </span>
            </button>
            {!collapsed && <div className="mt-1">{children}</div>}
        </div>
    );
}

// ─── Tree builder for preview ─────────────────────────────────────────────────

interface PreviewNode {
    kind: "category";
    name: string;
    path: string[];
    children: PreviewNode[];
    inputs: InputDefinition[];
}

interface BuildNode {
    children: Map<string, BuildNode>;
    inputs: InputDefinition[];
}

function buildPreviewTree(defs: InputDefinition[]): PreviewNode[] {
    const root: BuildNode = { children: new Map(), inputs: [] };

    for (const def of defs) {
        let node = root;
        for (const seg of def.categoryPath) {
            if (!node.children.has(seg))
                node.children.set(seg, { children: new Map(), inputs: [] });
            node = node.children.get(seg)!;
        }
        node.inputs.push(def);
    }

    function toNodes(m: BuildNode): PreviewNode[] {
        return [...m.children.entries()].map(([name, child]) => ({
            kind: "category" as const,
            name,
            path: [],
            children: toNodes(child),
            inputs: child.inputs,
        }));
    }

    return [
        ...(root.inputs.length > 0
            ? [{ kind: "category" as const, name: "(Uncategorized)", path: [], children: [], inputs: root.inputs }]
            : []),
        ...toNodes(root),
    ];
}

function RenderPreviewNode({
    node,
    previewState,
    onChange,
    depth,
}: {
    node: PreviewNode;
    previewState: Record<InputId, unknown>;
    onChange: (id: InputId, v: unknown) => void;
    depth: number;
}) {
    return (
        <PreviewCategory name={node.name} depth={depth}>
            {node.inputs.map((def) => {
                const isVisible = !def.visibilityCondition || evaluateCondition(def.visibilityCondition, previewState);
                const isEnabled = !def.enabledCondition || evaluateCondition(def.enabledCondition, previewState);

                if (!isVisible) return null;
                return (
                    <div
                        key={def.id}
                        className={`flex items-start gap-2 py-1 px-2 rounded ${!isEnabled ? "opacity-50" : ""}`}
                    >
                        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-zinc-200 truncate">{def.label}</span>
                                {def.advanced && (
                                    <span className="text-[8px] text-zinc-600 border border-zinc-700/40 rounded px-1">adv</span>
                                )}
                            </div>
                            {def.description && (
                                <span className="text-[10px] text-zinc-600 leading-tight">{def.description}</span>
                            )}
                        </div>
                        <div className="shrink-0" style={{ minWidth: 120, maxWidth: 200 }}>
                            <PreviewControl
                                def={def}
                                value={previewState[def.id] ?? def.defaultValue}
                                disabled={!isEnabled}
                                onChange={(v) => onChange(def.id, v)}
                            />
                        </div>
                    </div>
                );
            })}
            {node.children.map((child) => (
                <RenderPreviewNode
                    key={child.name}
                    node={child}
                    previewState={previewState}
                    onChange={onChange}
                    depth={depth + 1}
                />
            ))}
        </PreviewCategory>
    );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface InputPreviewProps {
    definitions: InputDefinition[];
}

export function InputPreview({ definitions }: InputPreviewProps) {
    const [previewState, setPreviewState] = useState<Record<InputId, unknown>>(() =>
        initPreviewState(definitions),
    );
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showControllers, setShowControllers] = useState(true);

    const setValue = (id: InputId, v: unknown) =>
        setPreviewState((s) => ({ ...s, [id]: v }));

    const reset = () => setPreviewState(initPreviewState(definitions));

    // Controller inputs (referenced by conditions of other inputs)
    const controllerIds = useMemo(() => {
        const usedBy = buildUsedBy(definitions);
        return new Set([...usedBy.entries()].filter(([, s]) => s.size > 0).map(([id]) => id));
    }, [definitions]);

    // Filter based on toggles
    const visibleDefs = definitions.filter((d) => {
        if (!showAdvanced && d.advanced) return false;
        return true;
    });

    const controllers = definitions.filter((d) => controllerIds.has(d.id));
    const tree = buildPreviewTree(visibleDefs);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                    Live Preview
                </span>
                <label className="flex items-center gap-1 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showAdvanced}
                        onChange={(e) => setShowAdvanced(e.target.checked)}
                        className="rounded accent-blue-500"
                    />
                    <span className="text-[10px] text-zinc-500">advanced</span>
                </label>
                <button
                    onClick={reset}
                    className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors"
                    title="Reset all to defaults"
                >
                    reset
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Controllers panel */}
                {controllers.length > 0 && (
                    <div className="border-b border-zinc-800">
                        <button
                            onClick={() => setShowControllers((v) => !v)}
                            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-zinc-800/40 transition-colors"
                        >
                            <span className="text-[9px] text-zinc-600">{showControllers ? "▼" : "▶"}</span>
                            <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider flex-1">
                                Controllers
                            </span>
                            <span className="text-[9px] text-zinc-600">{controllers.length}</span>
                        </button>
                        {showControllers && (
                            <div className="px-3 pb-2">
                                {controllers.map((def) => {
                                    const isEnabled = !def.enabledCondition || evaluateCondition(def.enabledCondition, previewState);
                                    return (
                                        <div key={def.id} className="flex items-center gap-2 py-0.5">
                                            <span className="text-[11px] text-amber-300/80 flex-1 truncate">{def.label}</span>
                                            <div className="shrink-0" style={{ minWidth: 100 }}>
                                                <PreviewControl
                                                    def={def}
                                                    value={previewState[def.id] ?? def.defaultValue}
                                                    disabled={!isEnabled}
                                                    onChange={(v) => setValue(def.id, v)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Main form */}
                <div className="px-3 pt-3 pb-6">
                    {tree.length === 0 && (
                        <div className="text-[11px] text-zinc-600 italic">
                            No user-visible inputs.
                        </div>
                    )}
                    {tree.map((node) => (
                        <RenderPreviewNode
                            key={node.name}
                            node={node}
                            previewState={previewState}
                            onChange={setValue}
                            depth={0}
                        />
                    ))}
                </div>
            </div>

            {/* State summary (compact) */}
            <div className="border-t border-zinc-800 px-3 py-1.5 shrink-0">
                <div className="text-[9px] text-zinc-600 truncate font-mono">
                    {definitions.length} inputs ·{" "}
                    {definitions.filter((d) => !d.visibilityCondition || evaluateCondition(d.visibilityCondition, previewState)).length} visible
                </div>
            </div>
        </div>
    );
}
