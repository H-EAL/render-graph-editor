import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { newId } from '../../utils/id';
import { getResourceUsage, type ResourceUsage } from '../../utils/dependencyGraph';
import type {
  RenderTarget, Buffer, BlendState, Shader, InputParameter,
  TextureFormat, ShaderStage, InputParamType, BlendFactor, BlendOp, ResourceId,
} from '../../types';

// ─── Format/Stage options ─────────────────────────────────────────────────────

const FORMAT_OPTS: { value: TextureFormat; label: string }[] = [
  { value: 'rgba8', label: 'RGBA8' }, { value: 'rgba16f', label: 'RGBA16F' },
  { value: 'rgba32f', label: 'RGBA32F' }, { value: 'r11g11b10f', label: 'R11G11B10F' },
  { value: 'rg16f', label: 'RG16F' }, { value: 'r32f', label: 'R32F' },
  { value: 'd32f', label: 'D32F' }, { value: 'd24s8', label: 'D24S8' },
  { value: 'bc1', label: 'BC1' }, { value: 'bc3', label: 'BC3' },
  { value: 'bc5', label: 'BC5' }, { value: 'bc7', label: 'BC7' },
];

const STAGE_OPTS: { value: ShaderStage; label: string }[] = [
  { value: 'vertex', label: 'Vertex' }, { value: 'fragment', label: 'Fragment' },
  { value: 'compute', label: 'Compute' }, { value: 'raygen', label: 'Raygen' },
  { value: 'miss', label: 'Miss' }, { value: 'closesthit', label: 'Closest Hit' },
];

const PARAM_TYPE_OPTS: { value: InputParamType; label: string }[] = [
  { value: 'bool', label: 'Bool' }, { value: 'float', label: 'Float' },
  { value: 'uint', label: 'Uint' }, { value: 'int', label: 'Int' },
  { value: 'vec2', label: 'Vec2' }, { value: 'vec3', label: 'Vec3' },
  { value: 'vec4', label: 'Vec4' }, { value: 'color', label: 'Color' },
];

const BLEND_FACTOR_OPTS: { value: BlendFactor; label: string }[] = [
  { value: 'zero', label: 'Zero' }, { value: 'one', label: 'One' },
  { value: 'srcColor', label: 'Src Color' }, { value: 'oneMinusSrcColor', label: '1 - Src Color' },
  { value: 'dstColor', label: 'Dst Color' }, { value: 'oneMinusDstColor', label: '1 - Dst Color' },
  { value: 'srcAlpha', label: 'Src Alpha' }, { value: 'oneMinusSrcAlpha', label: '1 - Src Alpha' },
  { value: 'dstAlpha', label: 'Dst Alpha' }, { value: 'oneMinusDstAlpha', label: '1 - Dst Alpha' },
];

const BLEND_OP_OPTS: { value: BlendOp; label: string }[] = [
  { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' },
  { value: 'reverseSubtract', label: 'Reverse Subtract' },
  { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' },
];

// ─── Shared: dead-write warning ───────────────────────────────────────────────

function DeadWriteWarning() {
  return (
    <span
      className="shrink-0 text-[9px] text-amber-400 font-bold leading-none"
      title="Written but never read — result is discarded">⚠</span>
  );
}

// ─── Shared: usage badge ──────────────────────────────────────────────────────

function UsageBadge({ usage }: { usage: ResourceUsage | undefined }) {
  if (!usage) return null;
  const w = usage.writers.length, r = usage.readers.length;
  if (w === 0 && r === 0) return null;
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {w > 0 && <span className="text-[9px] font-mono text-amber-500/80">{w}W</span>}
      {r > 0 && <span className="text-[9px] font-mono text-sky-500/80">{r}R</span>}
    </span>
  );
}

// ─── Panel group header ───────────────────────────────────────────────────────

function PanelGroup({ label, variant = 'library' }: { label: string; variant?: 'library' | 'tool' }) {
  const labelCls = variant === 'tool' ? 'text-teal-500/80' : 'text-zinc-500';
  const ruleCls  = variant === 'tool' ? 'bg-teal-800/30'   : 'bg-zinc-700/50';
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 ${labelCls}`}>{label}</span>
      <div className={`flex-1 h-px ${ruleCls}`} />
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function ResourceSection({ title, count, children, variant = 'library' }: {
  title: string; count: number; children: React.ReactNode; variant?: 'library' | 'tool';
}) {
  const [open, setOpen] = useState(true);
  const titleCls  = variant === 'tool' ? 'text-teal-400/80'  : 'text-zinc-400';
  const headerCls = variant === 'tool'
    ? 'bg-teal-950/30 hover:bg-teal-950/50'
    : 'bg-zinc-800/50 hover:bg-zinc-800/80';
  return (
    <div className="border-b border-zinc-700/40">
      <button
        className={`w-full flex items-center justify-between px-3 py-2 text-left ${headerCls}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`text-xs font-semibold uppercase tracking-wider ${titleCls}`}>{title}</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">{count}</span>
          <span className="text-zinc-500 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

// ─── Item selection wrapper ───────────────────────────────────────────────────

function itemCls(isSelected: boolean) {
  return `bg-zinc-800/60 rounded mb-1 overflow-hidden border transition-colors
    ${isSelected
      ? 'border-sky-500/60 ring-1 ring-sky-500/20'
      : 'border-zinc-700/40'}`;
}

// ─── Render Targets ───────────────────────────────────────────────────────────

function RenderTargetItem({ rt, isSelected, onSelect, isPinned, onPin, usage, hasWarning }: {
  rt: RenderTarget; isSelected: boolean; onSelect: () => void;
  isPinned: boolean; onPin: () => void; usage?: ResourceUsage; hasWarning?: boolean;
}) {
  const { updateRenderTarget, deleteRenderTarget } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<RenderTarget>) => updateRenderTarget(rt.id, patch);

  return (
    <div className={itemCls(isSelected)}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30"
        onClick={() => { onSelect(); setExpanded(!expanded); }}>
        <span className="text-xs font-mono text-blue-300 flex-1 truncate">{rt.name}</span>
        {hasWarning && <DeadWriteWarning />}
        <UsageBadge usage={usage} />
        <span className="text-[10px] text-zinc-500 font-mono">{rt.format}</span>
        <span className="text-[10px] text-zinc-600">{String(rt.width)}×{String(rt.height)}</span>
        <button onClick={(e) => { e.stopPropagation(); onPin(); }}
          className={`text-xs px-0.5 transition-colors ${isPinned ? 'text-purple-400 hover:text-purple-200' : 'text-zinc-700 hover:text-purple-400'}`}
          title={isPinned ? 'Unpin from timeline' : 'Pin to timeline'}>📌</button>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${rt.name}"?`)) deleteRenderTarget(rt.id); }} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        <span className="text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-zinc-700/30 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name" value={rt.name} onChange={(e) => u({ name: e.target.value })} />
            <Select label="Format" options={FORMAT_OPTS} value={rt.format} onChange={(e) => u({ format: e.target.value as TextureFormat })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input label="Width" value={String(rt.width)} onChange={(e) => u({ width: e.target.value })} />
            <Input label="Height" value={String(rt.height)} onChange={(e) => u({ height: e.target.value })} />
            <Input label="Mips" type="number" value={rt.mips} onChange={(e) => u({ mips: parseInt(e.target.value) || 1 })} />
          </div>
          <Input label="Description" value={rt.description ?? ''} onChange={(e) => u({ description: e.target.value })} placeholder="Optional…" />
        </div>
      )}
    </div>
  );
}

// ─── Buffers ──────────────────────────────────────────────────────────────────

function BufferItem({ buf, isSelected, onSelect, isPinned, onPin, usage, hasWarning }: {
  buf: Buffer; isSelected: boolean; onSelect: () => void;
  isPinned: boolean; onPin: () => void; usage?: ResourceUsage; hasWarning?: boolean;
}) {
  const { updateBuffer, deleteBuffer } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<Buffer>) => updateBuffer(buf.id, patch);

  return (
    <div className={itemCls(isSelected)}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30"
        onClick={() => { onSelect(); setExpanded(!expanded); }}>
        <span className="text-xs font-mono text-amber-300 flex-1 truncate">{buf.name}</span>
        {hasWarning && <DeadWriteWarning />}
        <UsageBadge usage={usage} />
        <span className="text-[10px] text-zinc-500 font-mono">{String(buf.size)}</span>
        <button onClick={(e) => { e.stopPropagation(); onPin(); }}
          className={`text-xs px-0.5 transition-colors ${isPinned ? 'text-purple-400 hover:text-purple-200' : 'text-zinc-700 hover:text-purple-400'}`}
          title={isPinned ? 'Unpin from timeline' : 'Pin to timeline'}>📌</button>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${buf.name}"?`)) deleteBuffer(buf.id); }} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        <span className="text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-zinc-700/30 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name" value={buf.name} onChange={(e) => u({ name: e.target.value })} />
            <Input label="Size (bytes)" value={String(buf.size)} onChange={(e) => u({ size: e.target.value })} />
          </div>
          <Input label="Description" value={buf.description ?? ''} onChange={(e) => u({ description: e.target.value })} placeholder="Optional…" />
        </div>
      )}
    </div>
  );
}

// ─── Blend States ─────────────────────────────────────────────────────────────

function BlendStateItem({ bs, isSelected, onSelect, usage }: {
  bs: BlendState; isSelected: boolean; onSelect: () => void; usage?: ResourceUsage;
}) {
  const { updateBlendState, deleteBlendState } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<BlendState>) => updateBlendState(bs.id, patch);

  return (
    <div className={itemCls(isSelected)}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30"
        onClick={() => { onSelect(); setExpanded(!expanded); }}>
        <span className="text-xs font-mono text-emerald-300 flex-1 truncate">{bs.name}</span>
        <UsageBadge usage={usage} />
        <span className="text-[10px] text-zinc-500">{bs.enabled ? 'blend on' : 'blend off'}</span>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${bs.name}"?`)) deleteBlendState(bs.id); }} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        <span className="text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-zinc-700/30 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name" value={bs.name} onChange={(e) => u({ name: e.target.value })} />
            <div className="flex flex-col gap-1"><label className="text-xs text-zinc-400 font-medium">Blending</label>
              <div className="flex items-center gap-2 pt-1.5">
                <input type="checkbox" checked={bs.enabled} onChange={(e) => u({ enabled: e.target.checked })} className="w-4 h-4 accent-blue-500" />
                <span className="text-xs text-zinc-400">Enabled</span>
              </div>
            </div>
          </div>
          {bs.enabled && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Select label="Src Color" options={BLEND_FACTOR_OPTS} value={bs.srcColor} onChange={(e) => u({ srcColor: e.target.value as BlendFactor })} />
                <Select label="Dst Color" options={BLEND_FACTOR_OPTS} value={bs.dstColor} onChange={(e) => u({ dstColor: e.target.value as BlendFactor })} />
                <Select label="Color Op" options={BLEND_OP_OPTS} value={bs.colorOp} onChange={(e) => u({ colorOp: e.target.value as BlendOp })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Select label="Src Alpha" options={BLEND_FACTOR_OPTS} value={bs.srcAlpha} onChange={(e) => u({ srcAlpha: e.target.value as BlendFactor })} />
                <Select label="Dst Alpha" options={BLEND_FACTOR_OPTS} value={bs.dstAlpha} onChange={(e) => u({ dstAlpha: e.target.value as BlendFactor })} />
                <Select label="Alpha Op" options={BLEND_OP_OPTS} value={bs.alphaOp} onChange={(e) => u({ alphaOp: e.target.value as BlendOp })} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shaders ─────────────────────────────────────────────────────────────────

function ShaderItem({ sh, isSelected, onSelect, usage }: {
  sh: Shader; isSelected: boolean; onSelect: () => void; usage?: ResourceUsage;
}) {
  const { updateShader, deleteShader } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<Shader>) => updateShader(sh.id, patch);

  return (
    <div className={itemCls(isSelected)}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30"
        onClick={() => { onSelect(); setExpanded(!expanded); }}>
        <span className="text-xs font-mono text-purple-300 flex-1 truncate">{sh.name}</span>
        <UsageBadge usage={usage} />
        <span className="text-[10px] text-zinc-500">{sh.stage}</span>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${sh.name}"?`)) deleteShader(sh.id); }} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        <span className="text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-zinc-700/30 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name" value={sh.name} onChange={(e) => u({ name: e.target.value })} />
            <Select label="Stage" options={STAGE_OPTS} value={sh.stage} onChange={(e) => u({ stage: e.target.value as ShaderStage })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Path" value={sh.path} onChange={(e) => u({ path: e.target.value })} placeholder="shaders/foo.hlsl" />
            <Input label="Entry Point" value={sh.entryPoint} onChange={(e) => u({ entryPoint: e.target.value })} placeholder="CSMain" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Input Parameters ─────────────────────────────────────────────────────────

function InputParamItem({ param, isSelected, onSelect, usage }: {
  param: InputParameter; isSelected: boolean; onSelect: () => void; usage?: ResourceUsage;
}) {
  const { updateInputParameter, deleteInputParameter } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<InputParameter>) => updateInputParameter(param.id, patch);

  return (
    <div className={itemCls(isSelected)}>
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30"
        onClick={() => { onSelect(); setExpanded(!expanded); }}>
        <span className="text-xs font-mono text-zinc-200 flex-1 truncate">{param.name}</span>
        <UsageBadge usage={usage} />
        <span className="text-[10px] text-zinc-500 font-mono">{param.type}</span>
        <span className="text-[10px] text-zinc-600 font-mono">{param.defaultValue}</span>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${param.name}"?`)) deleteInputParameter(param.id); }} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        <span className="text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-zinc-700/30 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name" value={param.name} onChange={(e) => u({ name: e.target.value })} />
            <Select label="Type" options={PARAM_TYPE_OPTS} value={param.type} onChange={(e) => u({ type: e.target.value as InputParamType })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Default Value" value={param.defaultValue} onChange={(e) => u({ defaultValue: e.target.value })} />
            <Input label="Description" value={param.description ?? ''} onChange={(e) => u({ description: e.target.value })} placeholder="Optional…" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resource filter ──────────────────────────────────────────────────────────

type ResourceFilter = 'all' | 'used' | 'written' | 'read';

// ─── Main ResourceEditor ──────────────────────────────────────────────────────

export function ResourceEditor() {
  const {
    resources, pipeline,
    selectedPassId, selectedResourceId, pinnedResourceIds,
    selectPass, selectResource, pinResource, unpinResource, setPinnedResources,
    addRenderTarget, addBuffer, addBlendState, addShader, addInputParameter,
  } = useStore();

  const [filter, setFilter] = useState<ResourceFilter>('all');

  const usageMap = useMemo(() => getResourceUsage(pipeline), [pipeline]);

  // ── Filter helpers ────────────────────────────────────────────────────────
  const selectedPass = selectedPassId ? pipeline.passes[selectedPassId] : null;
  const passWritten  = useMemo(() => new Set(selectedPass?.writes ?? []), [selectedPass]);
  const passRead     = useMemo(() => new Set(selectedPass?.reads   ?? []), [selectedPass]);

  const passFilter = (rid: ResourceId): boolean => {
    if (!selectedPass || filter === 'all') return true;
    if (filter === 'written') return passWritten.has(rid);
    if (filter === 'read')    return passRead.has(rid);
    return passWritten.has(rid) || passRead.has(rid); // 'used'
  };

  const filteredRTs      = resources.renderTargets.filter((r)  => passFilter(r.id));
  const filteredBuffers  = resources.buffers.filter((r)        => passFilter(r.id));
  const filteredBlend    = resources.blendStates.filter((r)    => passFilter(r.id));
  const filteredShaders  = resources.shaders.filter((r)        => passFilter(r.id));
  const filteredParams   = resources.inputParameters.filter((r) => passFilter(r.id));

  const filteredTotal = filteredRTs.length + filteredBuffers.length + filteredBlend.length
    + filteredShaders.length + filteredParams.length;

  // Show a section only when either not filtering or it has matching items
  const show = (items: unknown[]) => filter === 'all' || items.length > 0;

  // ── Toggle-select a resource ──────────────────────────────────────────────
  const toggleResource = (id: ResourceId) =>
    selectResource(selectedResourceId === id ? null : id);

  // ── Pin all / unpin all ───────────────────────────────────────────────────
  const pinnableIds = useMemo(
    () => [...resources.renderTargets.map((r) => r.id), ...resources.buffers.map((b) => b.id)],
    [resources.renderTargets, resources.buffers],
  );
  const allPinned = pinnableIds.length > 0 && pinnableIds.every((id) => pinnedResourceIds.includes(id));
  const togglePinAll = () => setPinnedResources(allPinned ? [] : pinnableIds);

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ── Library ── */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest shrink-0 text-zinc-500">Library</span>
        <div className="flex-1 h-px bg-zinc-700/50" />
        {pinnableIds.length > 0 && (
          <button
            onClick={togglePinAll}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors shrink-0
              ${allPinned
                ? 'border-purple-700/60 bg-purple-900/30 text-purple-300 hover:bg-purple-900/50'
                : 'border-zinc-700/50 text-zinc-500 hover:text-purple-400 hover:border-purple-700/40'}`}
            title={allPinned ? 'Unpin all resources from timeline' : 'Pin all resources to timeline'}>
            {allPinned ? '📌 unpin all' : '📍 pin all'}
          </button>
        )}
      </div>

      {/* Filter tabs — shown only when a pass is selected */}
      {selectedPass && (
        <div className="flex items-center gap-0.5 px-3 pb-1.5">
          <span className="text-[9px] text-zinc-600 mr-1 shrink-0">filter:</span>
          {(['all', 'used', 'written', 'read'] as const).map((f) => (
            <button key={f}
              onClick={() => setFilter(f)}
              title={f === 'all' ? 'Show all resources' : `Resources ${f} by "${selectedPass.name}"`}
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors
                ${filter === f ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Empty filter state */}
      {filter !== 'all' && filteredTotal === 0 && (
        <div className="px-3 py-2 text-[10px] text-zinc-600 italic">
          No resources {filter === 'written' ? 'written' : filter === 'read' ? 'read' : 'used'} by "{selectedPass?.name}"
        </div>
      )}

      {show(filteredRTs) && (
        <ResourceSection title="Render Targets" count={filteredRTs.length}>
          {filteredRTs.map((rt) => {
            const usage = usageMap.get(rt.id);
            return (
              <RenderTargetItem key={rt.id} rt={rt}
                isSelected={selectedResourceId === rt.id}
                onSelect={() => toggleResource(rt.id)}
                isPinned={pinnedResourceIds.includes(rt.id)}
                onPin={() => pinnedResourceIds.includes(rt.id) ? unpinResource(rt.id) : pinResource(rt.id)}
                usage={usage}
                hasWarning={!!usage && usage.writers.length > 0 && usage.readers.length === 0} />
            );
          })}
          {filter === 'all' && (
            <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
              onClick={() => addRenderTarget({ id: newId(), name: 'NewRenderTarget', format: 'rgba8', width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1 })}>
              + Render Target
            </Button>
          )}
        </ResourceSection>
      )}

      {show(filteredBuffers) && (
        <ResourceSection title="Buffers" count={filteredBuffers.length}>
          {filteredBuffers.map((b) => {
            const usage = usageMap.get(b.id);
            return (
              <BufferItem key={b.id} buf={b}
                isSelected={selectedResourceId === b.id}
                onSelect={() => toggleResource(b.id)}
                isPinned={pinnedResourceIds.includes(b.id)}
                onPin={() => pinnedResourceIds.includes(b.id) ? unpinResource(b.id) : pinResource(b.id)}
                usage={usage}
                hasWarning={!!usage && usage.writers.length > 0 && usage.readers.length === 0} />
            );
          })}
          {filter === 'all' && (
            <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
              onClick={() => addBuffer({ id: newId(), name: 'NewBuffer', size: 1024 })}>
              + Buffer
            </Button>
          )}
        </ResourceSection>
      )}

      {show(filteredBlend) && (
        <ResourceSection title="Blend States" count={filteredBlend.length}>
          {filteredBlend.map((bs) => (
            <BlendStateItem key={bs.id} bs={bs}
              isSelected={selectedResourceId === bs.id}
              onSelect={() => toggleResource(bs.id)}
              usage={usageMap.get(bs.id)} />
          ))}
          {filter === 'all' && (
            <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
              onClick={() => addBlendState({ id: newId(), name: 'NewBlendState', enabled: false, srcColor: 'one', dstColor: 'zero', colorOp: 'add', srcAlpha: 'one', dstAlpha: 'zero', alphaOp: 'add' })}>
              + Blend State
            </Button>
          )}
        </ResourceSection>
      )}

      {show(filteredShaders) && (
        <ResourceSection title="Shaders" count={filteredShaders.length}>
          {filteredShaders.map((sh) => (
            <ShaderItem key={sh.id} sh={sh}
              isSelected={selectedResourceId === sh.id}
              onSelect={() => toggleResource(sh.id)}
              usage={usageMap.get(sh.id)} />
          ))}
          {filter === 'all' && (
            <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
              onClick={() => addShader({ id: newId(), name: 'NewShader', stage: 'compute', path: '', entryPoint: 'CSMain' })}>
              + Shader
            </Button>
          )}
        </ResourceSection>
      )}

      {show(filteredParams) && (
        <ResourceSection title="Input Parameters" count={filteredParams.length}>
          {filteredParams.map((p) => (
            <InputParamItem key={p.id} param={p}
              isSelected={selectedResourceId === p.id}
              onSelect={() => toggleResource(p.id)}
              usage={usageMap.get(p.id)} />
          ))}
          {filter === 'all' && (
            <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
              onClick={() => addInputParameter({ id: newId(), name: 'NewParam', type: 'float', defaultValue: '0.0' })}>
              + Input Parameter
            </Button>
          )}
        </ResourceSection>
      )}

      {/* ── Inspection ── */}
      <div className="mx-3 mt-2 mb-0 border-t border-zinc-700/50" />
      <PanelGroup label="Inspection" variant="tool" />

      <ResourceSection title="Resource Usage Map" count={usageMap.size} variant="tool">
        {[...usageMap.entries()].map(([rid, usage]) => {
          const resName =
            resources.renderTargets.find((r) => r.id === rid)?.name ??
            resources.buffers.find((r) => r.id === rid)?.name ??
            resources.blendStates.find((r) => r.id === rid)?.name ??
            resources.shaders.find((r) => r.id === rid)?.name ??
            resources.inputParameters.find((r) => r.id === rid)?.name ??
            rid;
          const isHighlighted = rid === selectedResourceId;
          return (
            <div key={rid}
              className={`rounded mb-1 overflow-hidden border transition-colors cursor-pointer
                ${isHighlighted
                  ? 'bg-zinc-800/80 border-sky-500/50 ring-1 ring-sky-500/20'
                  : 'bg-zinc-800/60 border-zinc-700/40 hover:border-zinc-600/60'}`}
              onClick={() => toggleResource(rid)}>
              <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                <span className={`text-xs font-mono truncate ${isHighlighted ? 'text-sky-200' : 'text-zinc-200'}`}>
                  {resName}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {usage.writers.length > 0 && (
                    <span className="text-[9px] font-mono text-amber-500/80">{usage.writers.length}W</span>
                  )}
                  {usage.readers.length > 0 && (
                    <span className="text-[9px] font-mono text-sky-500/80">{usage.readers.length}R</span>
                  )}
                </span>
              </div>
              {(usage.writers.length > 0 || usage.readers.length > 0) && (
                <div className="border-t border-zinc-700/30 px-2 pb-1.5 flex flex-col gap-0.5">
                  {usage.writers.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-amber-400/80 font-mono w-3 shrink-0 font-bold">W</span>
                      <button
                        className="text-zinc-300 truncate hover:text-white hover:underline text-left flex-1"
                        onClick={(e) => { e.stopPropagation(); selectPass(w.passId); }}
                        title={`Jump to ${w.passName}`}>
                        {w.passName}
                      </button>
                      <span className="text-zinc-600 shrink-0 text-[9px]">{w.timelineName}</span>
                    </div>
                  ))}
                  {usage.readers.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-sky-400/80 font-mono w-3 shrink-0 font-bold">R</span>
                      <button
                        className="text-zinc-300 truncate hover:text-white hover:underline text-left flex-1"
                        onClick={(e) => { e.stopPropagation(); selectPass(r.passId); }}
                        title={`Jump to ${r.passName}`}>
                        {r.passName}
                      </button>
                      <span className="text-zinc-600 shrink-0 text-[9px]">{r.timelineName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {usageMap.size === 0 && <div className="text-xs text-zinc-600 p-2">No resource accesses declared yet.</div>}
      </ResourceSection>
    </div>
  );
}
