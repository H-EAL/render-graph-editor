import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { newId } from '../../utils/id';
import { getResourceUsage } from '../../utils/dependencyGraph';
import type {
  RenderTarget, Buffer, BlendState, Shader, InputParameter,
  TextureFormat, ShaderStage, InputParamType, BlendFactor, BlendOp
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

// ─── Section wrapper ──────────────────────────────────────────────────────────

function ResourceSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-zinc-700/40">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800/80 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">{count}</span>
          <span className="text-zinc-500 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

// ─── Render Targets ───────────────────────────────────────────────────────────

function RenderTargetItem({ rt }: { rt: RenderTarget }) {
  const { updateRenderTarget, deleteRenderTarget } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<RenderTarget>) => updateRenderTarget(rt.id, patch);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-blue-300 flex-1 truncate">{rt.name}</span>
        <span className="text-[10px] text-zinc-500 font-mono">{rt.format}</span>
        <span className="text-[10px] text-zinc-600">{String(rt.width)}×{String(rt.height)}</span>
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

function BufferItem({ buf }: { buf: Buffer }) {
  const { updateBuffer, deleteBuffer } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<Buffer>) => updateBuffer(buf.id, patch);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-amber-300 flex-1 truncate">{buf.name}</span>
        <span className="text-[10px] text-zinc-500 font-mono">{String(buf.size)}</span>
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

function BlendStateItem({ bs }: { bs: BlendState }) {
  const { updateBlendState, deleteBlendState } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<BlendState>) => updateBlendState(bs.id, patch);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-emerald-300 flex-1 truncate">{bs.name}</span>
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

function ShaderItem({ sh }: { sh: Shader }) {
  const { updateShader, deleteShader } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<Shader>) => updateShader(sh.id, patch);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-purple-300 flex-1 truncate">{sh.name}</span>
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

function InputParamItem({ param }: { param: InputParameter }) {
  const { updateInputParameter, deleteInputParameter } = useStore();
  const [expanded, setExpanded] = useState(false);
  const u = (patch: Partial<InputParameter>) => updateInputParameter(param.id, patch);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-700/30" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono text-zinc-200 flex-1 truncate">{param.name}</span>
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

// ─── Main ResourceEditor ──────────────────────────────────────────────────────

export function ResourceEditor() {
  const { resources, addRenderTarget, addBuffer, addBlendState, addShader, addInputParameter } = useStore();
  const pipeline = useStore((s) => s.pipeline);
  const usageMap = useMemo(() => getResourceUsage(pipeline), [pipeline]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <ResourceSection title="Render Targets" count={resources.renderTargets.length}>
        {resources.renderTargets.map((rt) => <RenderTargetItem key={rt.id} rt={rt} />)}
        <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
          onClick={() => addRenderTarget({ id: newId(), name: 'NewRenderTarget', format: 'rgba8', width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1 })}>
          + Render Target
        </Button>
      </ResourceSection>

      <ResourceSection title="Buffers" count={resources.buffers.length}>
        {resources.buffers.map((b) => <BufferItem key={b.id} buf={b} />)}
        <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
          onClick={() => addBuffer({ id: newId(), name: 'NewBuffer', size: 1024 })}>
          + Buffer
        </Button>
      </ResourceSection>

      <ResourceSection title="Blend States" count={resources.blendStates.length}>
        {resources.blendStates.map((bs) => <BlendStateItem key={bs.id} bs={bs} />)}
        <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
          onClick={() => addBlendState({ id: newId(), name: 'NewBlendState', enabled: false, srcColor: 'one', dstColor: 'zero', colorOp: 'add', srcAlpha: 'one', dstAlpha: 'zero', alphaOp: 'add' })}>
          + Blend State
        </Button>
      </ResourceSection>

      <ResourceSection title="Shaders" count={resources.shaders.length}>
        {resources.shaders.map((sh) => <ShaderItem key={sh.id} sh={sh} />)}
        <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
          onClick={() => addShader({ id: newId(), name: 'NewShader', stage: 'compute', path: '', entryPoint: 'CSMain' })}>
          + Shader
        </Button>
      </ResourceSection>

      <ResourceSection title="Input Parameters" count={resources.inputParameters.length}>
        {resources.inputParameters.map((p) => <InputParamItem key={p.id} param={p} />)}
        <Button variant="ghost" size="sm" className="w-full justify-center mt-1 border border-dashed border-zinc-700"
          onClick={() => addInputParameter({ id: newId(), name: 'NewParam', type: 'float', defaultValue: '0.0' })}>
          + Input Parameter
        </Button>
      </ResourceSection>

      <ResourceSection title="Resource Usage Map" count={usageMap.size}>
        {[...usageMap.entries()].map(([rid, usage]) => {
          const resName =
            resources.renderTargets.find((r) => r.id === rid)?.name ??
            resources.buffers.find((r) => r.id === rid)?.name ??
            resources.blendStates.find((r) => r.id === rid)?.name ??
            resources.shaders.find((r) => r.id === rid)?.name ??
            resources.inputParameters.find((r) => r.id === rid)?.name ??
            rid;
          return (
            <div key={rid} className="bg-zinc-800/60 border border-zinc-700/40 rounded mb-1 overflow-hidden">
              <div className="px-2 py-1.5 flex items-center justify-between">
                <span className="text-xs font-mono text-zinc-200 truncate">{resName}</span>
                <span className="text-[10px] text-zinc-500">
                  {usage.writers.length}W / {usage.readers.length}R
                </span>
              </div>
              {(usage.writers.length > 0 || usage.readers.length > 0) && (
                <div className="border-t border-zinc-700/30 px-2 pb-1.5 flex flex-col gap-0.5">
                  {usage.writers.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-red-400/70 font-mono w-3 shrink-0">W</span>
                      <span className="text-zinc-300 truncate">{w.passName}</span>
                      <span className="text-zinc-600 shrink-0">[{w.timelineName}]</span>
                    </div>
                  ))}
                  {usage.readers.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-blue-400/70 font-mono w-3 shrink-0">R</span>
                      <span className="text-zinc-300 truncate">{r.passName}</span>
                      <span className="text-zinc-600 shrink-0">[{r.timelineName}]</span>
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
