import { useMemo } from "react";
import { useStore } from "../../state/store";
import { StepList } from "../step/StepList";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { FieldRow, InspectorSection } from "../../components/ui/Panel";
import { TagsInput } from "../../components/ui/TagsInput";
import { MultiResourceSelect } from "../../components/ui/MultiResourceSelect";
import { deriveDependencies, getPassDependencies } from "../../utils/dependencyGraph";
import type { Pass, PassId } from "../../types";

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
    const { pipeline, resources, selectedPassId, updatePass } = useStore();
    const pass = selectedPassId ? pipeline.passes[selectedPassId] : null;

    const allEdges = useMemo(() => deriveDependencies(pipeline), [pipeline]);
    const passDeps = useMemo(
        () => (pass ? getPassDependencies(pass.id, allEdges) : { dependsOn: [], dependedOnBy: [] }),
        [pass, allEdges],
    );

    if (!pass) {
        return (
            <div className="p-4 text-xs text-zinc-500">Select a pass or resource to inspect.</div>
        );
    }

    const allResources = [
        ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
        ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
    ];

    const timelineOpts = pipeline.timelines.map((tl) => ({ value: tl.id, label: tl.name }));
    const timelineNames = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));

    const u = (patch: Partial<Omit<Pass, "id" | "steps">>) => updatePass(pass.id, patch);

    return (
        <div className="flex flex-col overflow-y-auto h-full">
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
                <FieldRow label="Notes">
                    <Textarea
                        value={pass.notes ?? ""}
                        onChange={(e) => u({ notes: e.target.value })}
                        rows={2}
                        placeholder="Optional description…"
                    />
                </FieldRow>
            </InspectorSection>

            <InspectorSection title="Resources">
                <div className="p-3 flex flex-col gap-3">
                    <MultiResourceSelect
                        label="Reads"
                        values={pass.reads}
                        onChange={(v) => u({ reads: v })}
                        options={allResources}
                        placeholder="Add read resource"
                    />
                    <MultiResourceSelect
                        label="Writes"
                        values={pass.writes}
                        onChange={(v) => u({ writes: v })}
                        options={allResources}
                        placeholder="Add write resource"
                    />
                </div>
            </InspectorSection>

            <InspectorSection title="Conditions">
                <div className="p-3">
                    <TagsInput
                        values={pass.conditions}
                        onChange={(v) => u({ conditions: v })}
                        placeholder="Add condition flag"
                    />
                </div>
            </InspectorSection>

            <InspectorSection title="Steps">
                <StepList passId={pass.id} />
            </InspectorSection>

            <InspectorSection title="Dependencies">
                {/* ── Manual deps ── */}
                <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-1">
                        Manual
                    </span>
                </div>
                {(pass.manualDeps ?? []).length === 0 && (
                    <div className="px-3 py-1.5 text-[10px] text-zinc-700 italic">
                        No manual dependencies.
                    </div>
                )}
                {(pass.manualDeps ?? []).map((depId) => {
                    const depPass = pipeline.passes[depId];
                    const depTl = depPass
                        ? pipeline.timelines.find((tl) => tl.passIds.includes(depId))
                        : undefined;
                    return (
                        <div
                            key={depId}
                            className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40 bg-amber-950/10"
                        >
                            <span className="text-[10px] text-zinc-500 shrink-0">← after</span>
                            <span className="text-xs text-zinc-200 font-medium flex-1 truncate">
                                {depPass?.name ?? depId}
                            </span>
                            {depTl && (
                                <span className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 rounded px-1 py-0.5 font-mono shrink-0">
                                    {depTl.name}
                                </span>
                            )}
                            <button
                                onClick={() => useStore.getState().removeManualDep(pass.id, depId)}
                                className="shrink-0 text-zinc-600 hover:text-red-400 text-xs"
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
                {/* Add manual dep: only show passes from OTHER timelines */}
                {(() => {
                    const otherPasses = pipeline.timelines
                        .filter((tl) => tl.id !== pass.timelineId)
                        .flatMap((tl) =>
                            tl.passIds
                                .filter(
                                    (pid) =>
                                        pid !== pass.id && !(pass.manualDeps ?? []).includes(pid),
                                )
                                .map((pid) => ({
                                    pid,
                                    passName: pipeline.passes[pid]?.name ?? pid,
                                    tlName: tl.name,
                                })),
                        );
                    if (otherPasses.length === 0) return null;
                    return (
                        <div className="px-3 py-2 border-b border-zinc-800/50">
                            <select
                                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                value=""
                                onChange={(e) => {
                                    if (e.target.value)
                                        useStore
                                            .getState()
                                            .addManualDep(pass.id, e.target.value as PassId);
                                }}
                            >
                                <option value="">+ Add manual dependency…</option>
                                {otherPasses.map(({ pid, passName, tlName }) => (
                                    <option key={pid} value={pid}>
                                        {tlName} / {passName}
                                    </option>
                                ))}
                            </select>
                        </div>
                    );
                })()}

                {/* ── Derived deps ── */}
                {(passDeps.dependsOn.length > 0 || passDeps.dependedOnBy.length > 0) && (
                    <>
                        <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                                Derived
                            </span>
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
                                    timelineName={
                                        timelineNames.get(edge.fromTimelineId) ??
                                        edge.fromTimelineId
                                    }
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
                                    timelineName={
                                        timelineNames.get(edge.toTimelineId) ?? edge.toTimelineId
                                    }
                                />
                            );
                        })}
                    </>
                )}
                {passDeps.dependsOn.length === 0 && passDeps.dependedOnBy.length === 0 && (
                    <div className="px-3 py-1.5 text-[10px] text-zinc-700 italic">
                        No derived dependencies.
                    </div>
                )}
            </InspectorSection>
        </div>
    );
}
