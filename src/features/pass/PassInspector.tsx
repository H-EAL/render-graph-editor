import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { StepList } from "../step/StepList";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { FieldRow, InspectorSection } from "../../components/ui/Panel";
import { deriveDependencies, getPassDependencies } from "../../utils/dependencyGraph";
import { inferPassResources, buildResourceOrigins } from "../../utils/inferStepResources";
import type { Pass, PassId, Step, VariantId } from "../../types";

// ─── Dependency display ───────────────────────────────────────────────────────

function DependencyRow({
    label,
    passName,
    resourceIds,
    isCrossTimeline,
    timelineName,
}: {
    label: string;
    passName: string;
    resourceIds: string[];
    isCrossTimeline: boolean;
    timelineName: string;
}) {
    const { resources } = useStore();
    const resourceNames = resourceIds.map(
        (rid) =>
            resources.renderTargets.find((r) => r.id === rid)?.name ??
            resources.buffers.find((r) => r.id === rid)?.name ??
            rid,
    );

    return (
        <div
            className={`flex flex-col gap-0.5 px-3 py-1.5 border-b border-zinc-800/50 ${isCrossTimeline ? "bg-purple-950/20" : ""}`}
        >
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 shrink-0">{label}</span>
                <span className="text-xs text-zinc-200 font-medium">{passName}</span>
                {isCrossTimeline && (
                    <span className="text-[10px] bg-purple-900/50 text-purple-300 border border-purple-700/40 rounded px-1 py-0.5 font-mono">
                        {timelineName} ↔
                    </span>
                )}
            </div>
            <div className="pl-4 flex flex-wrap gap-1">
                {resourceNames.map((name, i) => (
                    <span
                        key={i}
                        className="text-[10px] font-mono bg-zinc-700/60 text-zinc-400 rounded px-1 py-0.5"
                    >
                        {name}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function PassInspector() {
    const {
        pipeline,
        resources,
        inputDefinitions,
        selectedPassId,
        updatePass,
        selectResource,
setPassVariantEnum,
    } = useStore();
    const pass = selectedPassId ? pipeline.passes[selectedPassId] : null;
    const [editingVariantId, setEditingVariantId] = useState<VariantId | null>(null);

    // Reset variant tab when pass changes
    const [lastPassId, setLastPassId] = useState<string | null>(null);
    if (selectedPassId !== lastPassId) {
        setLastPassId(selectedPassId);
        setEditingVariantId(null);
    }

    const allEdges = useMemo(() => deriveDependencies(pipeline), [pipeline]);
    const passDeps = useMemo(
        () => (pass ? getPassDependencies(pass.id, allEdges) : { dependsOn: [], dependedOnBy: [] }),
        [pass, allEdges],
    );

    const derivedResources = useMemo(() => {
        if (!pass) return { reads: [] as string[], writes: [] as string[] };
        return inferPassResources(pass, pipeline.steps as Record<string, Step>);
    }, [pass, pipeline.steps]);

    const resourceOrigins = useMemo(() => {
        if (!pass) return new Map<string, string[]>();
        return buildResourceOrigins(pass, pipeline.steps as Record<string, Step>);
    }, [pass, pipeline.steps]);

    const resolvesPairs = useMemo(() => {
        if (!pass) return [] as { source: string; destination: string; stepName: string }[];
        const pairs: { source: string; destination: string; stepName: string }[] = [];
        for (const sid of pass.steps) {
            const step = pipeline.steps[sid];
            if (step?.type !== "raster") continue;
            for (const ra of step.attachments.resolveAttachments ?? []) {
                pairs.push({ source: ra.source, destination: ra.destination, stepName: step.name });
            }
        }
        return pairs;
    }, [pass, pipeline.steps]);

    if (!pass) {
        return (
            <div className="p-4 text-xs text-zinc-500">Select a pass or resource to inspect.</div>
        );
    }

    const variants = pass.variants ?? [];
    const hasEnum = !!pass.variantEnumInputId;

    // Auto-select first variant tab when enum is active and nothing selected
    const activeVariantId = hasEnum && editingVariantId === null && variants.length > 0
        ? variants[0].id
        : editingVariantId;

    const timelineOpts = pipeline.timelines.map((tl) => ({ value: tl.id, label: tl.name }));
    const timelineNames = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));

    // Bool input params for the condition picker
    const boolParams = resources.inputParameters.filter((p) => p.type === "bool");
    const boolParamByName = new Map(boolParams.map((p) => [p.name, p]));
    const conditionParamName = pass.conditions[0] ?? "";
    const conditionParamId = boolParamByName.get(conditionParamName)?.id ?? "";

    // Enum InputDefinitions for the variant picker
    const enumInputDefs = inputDefinitions.filter((d) => d.kind === "enum");

    const u = (patch: Partial<Omit<Pass, "id" | "steps">>) => updatePass(pass.id, patch);

    // Resource name resolver helper
    const resName = (rid: string) =>
        resources.renderTargets.find((r) => r.id === rid)?.name ??
        resources.buffers.find((b) => b.id === rid)?.name ??
        resources.inputParameters.find((p) => p.id === rid)?.name ??
        rid;

    return (
        <div className="flex flex-col overflow-y-auto h-full">
            {/* ── Identity ── */}
            <InspectorSection title="Identity">
                <FieldRow label="Name">
                    <Input value={pass.name} onChange={(e) => u({ name: e.target.value })} />
                </FieldRow>
                <FieldRow label="Timeline">
                    <Select
                        options={timelineOpts}
                        value={pass.timelineId}
                        onChange={(e) => {
                            const toId = e.target.value;
                            if (toId !== pass.timelineId) {
                                useStore.getState().movePassToTimeline(pass.id, toId);
                            }
                        }}
                    />
                </FieldRow>
                <FieldRow label="Enabled">
                    <input
                        type="checkbox"
                        checked={pass.enabled}
                        onChange={(e) => u({ enabled: e.target.checked })}
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                    />
                </FieldRow>

                {/* Condition — picks a bool input parameter */}
                <FieldRow label="Condition">
                    <div className="flex items-center gap-1.5 flex-1">
                        <select
                            className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500/60"
                            value={conditionParamId}
                            onChange={(e) => {
                                const param = boolParams.find((p) => p.id === e.target.value);
                                u({ conditions: param ? [param.name] : [] });
                            }}
                        >
                            <option value="">Always run</option>
                            {boolParams.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        {conditionParamName && !boolParamByName.has(conditionParamName) && (
                            <span className="text-[9px] text-amber-400/70 font-mono truncate max-w-[80px]" title="Condition references unknown input">
                                {conditionParamName}?
                            </span>
                        )}
                    </div>
                </FieldRow>

                {/* Variant enum picker */}
                <FieldRow label="Variants by">
                    <select
                        className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500/60"
                        value={pass.variantEnumInputId ?? ""}
                        onChange={(e) => {
                            setPassVariantEnum(pass.id, e.target.value || null);
                            setEditingVariantId(null);
                        }}
                    >
                        <option value="">No variants</option>
                        {enumInputDefs.map((d) => (
                            <option key={d.id} value={d.id}>{d.label}</option>
                        ))}
                    </select>
                </FieldRow>

                {/* Variant pills — show when enum is active */}
                {hasEnum && variants.length > 0 && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1">
                        {variants.map((v) => (
                            <span
                                key={v.id}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-900/40 border border-violet-700/40 text-violet-300"
                            >
                                {v.selector ? `${v.selector}: ` : ""}{v.name}
                            </span>
                        ))}
                    </div>
                )}

                <FieldRow label="Notes">
                    <Textarea
                        value={pass.notes ?? ""}
                        onChange={(e) => u({ notes: e.target.value })}
                        rows={2}
                        placeholder="Optional description…"
                    />
                </FieldRow>
            </InspectorSection>

            {/* ── Steps (common + variant tabs + fallback, all in one DndContext) ── */}
            <InspectorSection title="Steps">
                <StepList
                    passId={pass.id}
                    variants={hasEnum ? variants : undefined}
                    activeVariantId={hasEnum ? activeVariantId : undefined}
                    onVariantChange={(id) => setEditingVariantId(id)}

                />
            </InspectorSection>

            {/* ── Resources ── */}
            <InspectorSection title="Resources">
                {derivedResources.reads.length === 0 && derivedResources.writes.length === 0 ? (
                    <div className="px-3 py-2 text-[10px] text-zinc-600 italic">
                        No resources inferred from steps yet.
                    </div>
                ) : (
                    <div className="px-3 py-2 flex flex-col gap-2">
                        {derivedResources.reads.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Reads</span>
                                <div className="flex flex-wrap gap-1">
                                    {derivedResources.reads.map((rid) => (
                                        <span
                                            key={rid}
                                            title={resourceOrigins.get(rid)?.join("\n")}
                                            onClick={() => selectResource(rid)}
                                            className="text-[10px] font-mono bg-blue-900/30 text-blue-300 border border-blue-700/40 rounded px-1.5 py-0.5 cursor-pointer hover:bg-blue-800/50 hover:border-blue-600/60 transition-colors"
                                        >
                                            {resName(rid)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {derivedResources.writes.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Writes</span>
                                <div className="flex flex-wrap gap-1">
                                    {derivedResources.writes.map((rid) => (
                                        <span
                                            key={rid}
                                            title={resourceOrigins.get(rid)?.join("\n")}
                                            onClick={() => selectResource(rid)}
                                            className="text-[10px] font-mono bg-amber-900/30 text-amber-300 border border-amber-700/40 rounded px-1.5 py-0.5 cursor-pointer hover:bg-amber-800/50 hover:border-amber-600/60 transition-colors"
                                        >
                                            {resName(rid)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {resolvesPairs.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Resolves</span>
                                <div className="flex flex-col gap-0.5">
                                    {resolvesPairs.map((rp, i) => {
                                        const srcName = resources.renderTargets.find((r) => r.id === rp.source)?.name ?? rp.source;
                                        const dstName = resources.renderTargets.find((r) => r.id === rp.destination)?.name ?? rp.destination;
                                        return (
                                            <div key={i} className="flex items-center gap-1" title={rp.stepName}>
                                                <span className="text-[10px] font-mono bg-blue-900/30 text-blue-300 border border-blue-700/40 rounded px-1.5 py-0.5">{srcName}</span>
                                                <span className="text-zinc-500 text-[10px]">→</span>
                                                <span className="text-[10px] font-mono bg-amber-900/30 text-amber-300 border border-amber-700/40 rounded px-1.5 py-0.5">{dstName}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div className="px-3 pb-1 text-[9px] text-zinc-700 italic">
                    Derived from step definitions. Edit step attachments / shader bindings to change.
                </div>
            </InspectorSection>

            {/* ── Dependencies ── */}
            <InspectorSection title="Dependencies">
                <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-1">Manual</span>
                </div>
                {(pass.manualDeps ?? []).length === 0 && (
                    <div className="px-3 py-1.5 text-[10px] text-zinc-700 italic">No manual dependencies.</div>
                )}
                {(pass.manualDeps ?? []).map((depId) => {
                    const depPass = pipeline.passes[depId];
                    const depTl = depPass
                        ? pipeline.timelines.find((tl) => tl.passIds.includes(depId))
                        : undefined;
                    return (
                        <div key={depId} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40 bg-amber-950/10">
                            <span className="text-[10px] text-zinc-500 shrink-0">← after</span>
                            <span className="text-xs text-zinc-200 font-medium flex-1 truncate">{depPass?.name ?? depId}</span>
                            {depTl && (
                                <span className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 rounded px-1 py-0.5 font-mono shrink-0">{depTl.name}</span>
                            )}
                            <button onClick={() => useStore.getState().removeManualDep(pass.id, depId)} className="shrink-0 text-zinc-600 hover:text-red-400 text-xs">✕</button>
                        </div>
                    );
                })}
                {(() => {
                    const otherPasses = pipeline.timelines
                        .filter((tl) => tl.id !== pass.timelineId)
                        .flatMap((tl) =>
                            tl.passIds
                                .filter((pid) => pid !== pass.id && !(pass.manualDeps ?? []).includes(pid))
                                .map((pid) => ({ pid, passName: pipeline.passes[pid]?.name ?? pid, tlName: tl.name })),
                        );
                    if (otherPasses.length === 0) return null;
                    return (
                        <div className="px-3 py-2 border-b border-zinc-800/50">
                            <select
                                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                value=""
                                onChange={(e) => {
                                    if (e.target.value) useStore.getState().addManualDep(pass.id, e.target.value as PassId);
                                }}
                            >
                                <option value="">+ Add manual dependency…</option>
                                {otherPasses.map(({ pid, passName, tlName }) => (
                                    <option key={pid} value={pid}>{tlName} / {passName}</option>
                                ))}
                            </select>
                        </div>
                    );
                })()}
                {(passDeps.dependsOn.length > 0 || passDeps.dependedOnBy.length > 0) && (
                    <>
                        <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Derived</span>
                        </div>
                        {passDeps.dependsOn.map((edge) => {
                            const fromPass = pipeline.passes[edge.fromPassId];
                            return (
                                <DependencyRow
                                    key={edge.id}
                                    label="← depends on"
                                    passName={fromPass?.name ?? edge.fromPassId}
                                    resourceIds={edge.resourceIds}
                                    isCrossTimeline={edge.isCrossTimeline}
                                    timelineName={timelineNames.get(edge.fromTimelineId) ?? edge.fromTimelineId}
                                />
                            );
                        })}
                        {passDeps.dependedOnBy.map((edge) => {
                            const toPass = pipeline.passes[edge.toPassId];
                            return (
                                <DependencyRow
                                    key={edge.id}
                                    label="→ needed by"
                                    passName={toPass?.name ?? edge.toPassId}
                                    resourceIds={edge.resourceIds}
                                    isCrossTimeline={edge.isCrossTimeline}
                                    timelineName={timelineNames.get(edge.toTimelineId) ?? edge.toTimelineId}
                                />
                            );
                        })}
                    </>
                )}
                {passDeps.dependsOn.length === 0 && passDeps.dependedOnBy.length === 0 && (
                    <div className="px-3 py-1.5 text-[10px] text-zinc-700 italic">No derived dependencies.</div>
                )}
            </InspectorSection>
        </div>
    );
}
