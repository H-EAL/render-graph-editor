import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { FieldRow, InspectorSection } from '../../components/ui/Panel';
import { TagsInput } from '../../components/ui/TagsInput';
import { MultiResourceSelect } from '../../components/ui/MultiResourceSelect';
import { ResourceSelect } from '../../components/ui/ResourceSelect';
import { deriveDependencies, getPassDependencies } from '../../utils/dependencyGraph';
import type { Pass, ColorAttachment, DepthAttachment, LoadOp, StoreOp, PassId } from '../../types';

const KIND_OPTIONS = [
  { value: 'raster', label: 'Raster' },
  { value: 'compute', label: 'Compute' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'raytracing', label: 'Ray Tracing' },
];

const LOAD_OPS: { value: LoadOp; label: string }[] = [
  { value: 'load', label: 'Load' },
  { value: 'clear', label: 'Clear' },
  { value: 'dontCare', label: "Don't Care" },
];

const STORE_OPS: { value: StoreOp; label: string }[] = [
  { value: 'store', label: 'Store' },
  { value: 'dontCare', label: "Don't Care" },
];

function ColorAttachmentRow({ idx, att, pass }: { idx: number; att: ColorAttachment; pass: Pass }) {
  const { updatePass, resources } = useStore();
  const rtOpts = resources.renderTargets.map((r) => ({ value: r.id, label: r.name }));
  const blendOpts = resources.blendStates.map((b) => ({ value: b.id, label: b.name }));

  const updateAtt = (patch: Partial<ColorAttachment>) => {
    if (!pass.rasterAttachments) return;
    const colorAttachments = pass.rasterAttachments.colorAttachments.map((a, i) =>
      i === idx ? { ...a, ...patch } : a
    );
    updatePass(pass.id, { rasterAttachments: { ...pass.rasterAttachments, colorAttachments } });
  };

  const removeAtt = () => {
    if (!pass.rasterAttachments) return;
    const colorAttachments = pass.rasterAttachments.colorAttachments.filter((_, i) => i !== idx);
    updatePass(pass.id, { rasterAttachments: { ...pass.rasterAttachments, colorAttachments } });
  };

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/40 rounded mx-3 mb-2 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/80">
        <span className="text-[10px] text-zinc-400 font-semibold">COLOR {idx}</span>
        <button onClick={removeAtt} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
      </div>
      <FieldRow label="Target">
        <ResourceSelect value={att.target} onChange={(v) => updateAtt({ target: v })} options={rtOpts} />
      </FieldRow>
      <FieldRow label="Load Op">
        <Select options={LOAD_OPS} value={att.loadOp} onChange={(e) => updateAtt({ loadOp: e.target.value as LoadOp })} />
      </FieldRow>
      <FieldRow label="Store Op">
        <Select options={STORE_OPS} value={att.storeOp} onChange={(e) => updateAtt({ storeOp: e.target.value as StoreOp })} />
      </FieldRow>
      {att.loadOp === 'clear' && (
        <div className="grid grid-cols-[120px_1fr] gap-2 items-center py-1.5 px-3 border-b border-zinc-800/60">
          <label className="text-xs text-zinc-500">Clear Value</label>
          <div className="flex gap-1">
            {att.clearValue.map((v, j) => (
              <input key={j} type="number" step="0.01" value={v}
                onChange={(e) => {
                  const cv = [...att.clearValue] as [number, number, number, number];
                  cv[j] = parseFloat(e.target.value) || 0;
                  updateAtt({ clearValue: cv });
                }}
                className="w-12 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1" />
            ))}
          </div>
        </div>
      )}
      <FieldRow label="Blend State">
        <ResourceSelect value={att.blendState ?? ''} onChange={(v) => updateAtt({ blendState: v })} options={blendOpts} />
      </FieldRow>
    </div>
  );
}

function DepthAttachmentSection({ pass }: { pass: Pass }) {
  const { updatePass, resources } = useStore();
  const rtOpts = resources.renderTargets.filter((r) => r.format.startsWith('d')).map((r) => ({ value: r.id, label: r.name }));
  const dep = pass.rasterAttachments?.depthAttachment;

  const updateDep = (patch: Partial<DepthAttachment>) => {
    if (!pass.rasterAttachments) return;
    updatePass(pass.id, {
      rasterAttachments: {
        ...pass.rasterAttachments,
        depthAttachment: dep ? { ...dep, ...patch } : { target: '', loadOp: 'clear', storeOp: 'store', clearValue: 1, ...patch },
      },
    });
  };

  const removeDep = () => {
    if (!pass.rasterAttachments) return;
    updatePass(pass.id, { rasterAttachments: { ...pass.rasterAttachments, depthAttachment: undefined } });
  };

  if (!dep) {
    return (
      <div className="px-3 pb-2">
        <button onClick={() => updateDep({ target: '', loadOp: 'clear', storeOp: 'store', clearValue: 1 })}
          className="text-xs text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 rounded px-2 py-1 w-full">
          + Add Depth Attachment
        </button>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/40 rounded mx-3 mb-2 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/80">
        <span className="text-[10px] text-zinc-400 font-semibold">DEPTH</span>
        <button onClick={removeDep} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
      </div>
      <FieldRow label="Target">
        <ResourceSelect value={dep.target} onChange={(v) => updateDep({ target: v })} options={rtOpts} allowEmpty />
      </FieldRow>
      <FieldRow label="Load Op">
        <Select options={LOAD_OPS} value={dep.loadOp} onChange={(e) => updateDep({ loadOp: e.target.value as LoadOp })} />
      </FieldRow>
      <FieldRow label="Store Op">
        <Select options={STORE_OPS} value={dep.storeOp} onChange={(e) => updateDep({ storeOp: e.target.value as StoreOp })} />
      </FieldRow>
      {dep.loadOp === 'clear' && (
        <FieldRow label="Clear Value">
          <input type="number" step="0.01" value={dep.clearValue}
            onChange={(e) => updateDep({ clearValue: parseFloat(e.target.value) || 0 })}
            className="w-20 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1" />
        </FieldRow>
      )}
    </div>
  );
}

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
      rid
  );

  return (
    <div className={`flex flex-col gap-0.5 px-3 py-1.5 border-b border-zinc-800/50 ${isCrossTimeline ? 'bg-purple-950/20' : ''}`}>
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
          <span key={i} className="text-[10px] font-mono bg-zinc-700/60 text-zinc-400 rounded px-1 py-0.5">{name}</span>
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
    [pass, allEdges]
  );

  if (!pass) {
    return <div className="p-4 text-xs text-zinc-500">Select a pass to inspect.</div>;
  }

  const allResources = [
    ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
    ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
  ];

  const timelineOpts = pipeline.timelines.map((tl) => ({ value: tl.id, label: tl.name }));
  const timelineNames = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));

  const u = (patch: Partial<Omit<Pass, 'id' | 'steps'>>) => updatePass(pass.id, patch);

  const addColorAttachment = () => {
    const ra = pass.rasterAttachments ?? { colorAttachments: [] };
    updatePass(pass.id, {
      rasterAttachments: {
        ...ra,
        colorAttachments: [...ra.colorAttachments, { target: '', loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      },
    });
  };

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      <InspectorSection title="Identity">
        <FieldRow label="Name">
          <Input value={pass.name} onChange={(e) => u({ name: e.target.value })} />
        </FieldRow>
        <FieldRow label="Timeline">
          <Select options={timelineOpts} value={pass.timelineId}
            onChange={(e) => {
              const toId = e.target.value;
              if (toId !== pass.timelineId) {
                // Use store movePassToTimeline
                useStore.getState().movePassToTimeline(pass.id, toId);
              }
            }} />
        </FieldRow>
        <FieldRow label="Kind">
          <Select options={KIND_OPTIONS} value={pass.kind} onChange={(e) => u({ kind: e.target.value as Pass['kind'] })} />
        </FieldRow>
        <FieldRow label="Enabled">
          <input type="checkbox" checked={pass.enabled} onChange={(e) => u({ enabled: e.target.checked })}
            className="w-4 h-4 accent-blue-500 cursor-pointer" />
        </FieldRow>
        <FieldRow label="Notes">
          <Textarea value={pass.notes ?? ''} onChange={(e) => u({ notes: e.target.value })} rows={2} placeholder="Optional description…" />
        </FieldRow>
      </InspectorSection>

      {pass.kind === 'raster' && (
        <InspectorSection title="Attachments">
          {pass.rasterAttachments?.colorAttachments.map((att, i) => (
            <ColorAttachmentRow key={i} idx={i} att={att} pass={pass} />
          ))}
          <div className="px-3 pb-2">
            <button onClick={addColorAttachment}
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 rounded px-2 py-1 w-full">
              + Add Color Attachment
            </button>
          </div>
          <DepthAttachmentSection pass={pass} />
        </InspectorSection>
      )}

      <InspectorSection title="Resources">
        <div className="p-3 flex flex-col gap-3">
          <MultiResourceSelect label="Reads" values={pass.reads} onChange={(v) => u({ reads: v })} options={allResources} placeholder="Add read resource" />
          <MultiResourceSelect label="Writes" values={pass.writes} onChange={(v) => u({ writes: v })} options={allResources} placeholder="Add write resource" />
        </div>
      </InspectorSection>

      <InspectorSection title="Conditions">
        <div className="p-3">
          <TagsInput values={pass.conditions} onChange={(v) => u({ conditions: v })} placeholder="Add condition flag" />
        </div>
      </InspectorSection>

      <InspectorSection title="Dependencies">
        {/* ── Manual deps ── */}
        <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex-1">Manual</span>
        </div>
        {(pass.manualDeps ?? []).length === 0 && (
          <div className="px-3 py-1.5 text-[10px] text-zinc-700 italic">No manual dependencies.</div>
        )}
        {(pass.manualDeps ?? []).map((depId) => {
          const depPass = pipeline.passes[depId];
          const depTl   = depPass ? pipeline.timelines.find((tl) => tl.passIds.includes(depId)) : undefined;
          return (
            <div key={depId} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40 bg-amber-950/10">
              <span className="text-[10px] text-zinc-500 shrink-0">← after</span>
              <span className="text-xs text-zinc-200 font-medium flex-1 truncate">{depPass?.name ?? depId}</span>
              {depTl && (
                <span className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 rounded px-1 py-0.5 font-mono shrink-0">
                  {depTl.name}
                </span>
              )}
              <button
                onClick={() => useStore.getState().removeManualDep(pass.id, depId)}
                className="shrink-0 text-zinc-600 hover:text-red-400 text-xs">✕</button>
            </div>
          );
        })}
        {/* Add manual dep: only show passes from OTHER timelines */}
        {(() => {
          const otherPasses = pipeline.timelines
            .filter((tl) => tl.id !== pass.timelineId)
            .flatMap((tl) =>
              tl.passIds
                .filter((pid) => pid !== pass.id && !(pass.manualDeps ?? []).includes(pid))
                .map((pid) => ({ pid, passName: pipeline.passes[pid]?.name ?? pid, tlName: tl.name }))
            );
          if (otherPasses.length === 0) return null;
          return (
            <div className="px-3 py-2 border-b border-zinc-800/50">
              <select
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                value=""
                onChange={(e) => { if (e.target.value) useStore.getState().addManualDep(pass.id, e.target.value as PassId); }}
              >
                <option value="">+ Add manual dependency…</option>
                {otherPasses.map(({ pid, passName, tlName }) => (
                  <option key={pid} value={pid}>{tlName} / {passName}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* ── Derived deps ── */}
        {(passDeps.dependsOn.length > 0 || passDeps.dependedOnBy.length > 0) && (
          <>
            <div className="px-3 pt-2 pb-1 flex items-center gap-2 border-b border-zinc-800/50">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Derived</span>
            </div>
            {passDeps.dependsOn.map((edge) => {
              const fromPass = pipeline.passes[edge.fromPassId];
              return (
                <DependencyRow key={edge.id}
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
                <DependencyRow key={edge.id}
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
