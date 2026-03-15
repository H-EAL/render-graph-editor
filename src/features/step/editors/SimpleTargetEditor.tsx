import { useStore } from '../../../state/store';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { FieldRow } from '../../../components/ui/Panel';
import type { FillBufferStep, GenerateMipChainStep, ViewportStep, DrawDebugLinesStep } from '../../../types';

const FILTER_OPTS = [{ value: 'nearest', label: 'Nearest' }, { value: 'linear', label: 'Linear' }];

export function FillBufferEditor({ step }: { step: FillBufferStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const bufOpts = resources.buffers.map((b) => ({ value: b.id, label: b.name }));
  return (
    <>
      <FieldRow label="Buffer">
        <ResourceSelect value={step.target} onChange={(v) => u({ target: v })} options={bufOpts} />
      </FieldRow>
      <FieldRow label="Value">
        <Input type="number" value={step.value} onChange={(e) => u({ value: parseFloat(e.target.value) || 0 })} />
      </FieldRow>
    </>
  );
}

export function GenerateMipChainEditor({ step }: { step: GenerateMipChainStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const rtOpts = resources.renderTargets.map((r) => ({ value: r.id, label: r.name }));
  return (
    <>
      <FieldRow label="Target">
        <ResourceSelect value={step.target} onChange={(v) => u({ target: v })} options={rtOpts} />
      </FieldRow>
      <FieldRow label="Filter">
        <Select options={FILTER_OPTS} value={step.filter} onChange={(e) => u({ filter: e.target.value })} />
      </FieldRow>
    </>
  );
}

export function ViewportEditor({ step }: { step: ViewportStep }) {
  const { updateStep } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  return (
    <>
      <FieldRow label="X"><Input type="number" value={step.x} onChange={(e) => u({ x: parseInt(e.target.value) || 0 })} /></FieldRow>
      <FieldRow label="Y"><Input type="number" value={step.y} onChange={(e) => u({ y: parseInt(e.target.value) || 0 })} /></FieldRow>
      <FieldRow label="Width"><Input value={String(step.width)} onChange={(e) => u({ width: e.target.value })} placeholder="viewport.width" /></FieldRow>
      <FieldRow label="Height"><Input value={String(step.height)} onChange={(e) => u({ height: e.target.value })} placeholder="viewport.height" /></FieldRow>
      <FieldRow label="Min Depth"><Input type="number" step="0.01" value={step.minDepth} onChange={(e) => u({ minDepth: parseFloat(e.target.value) || 0 })} /></FieldRow>
      <FieldRow label="Max Depth"><Input type="number" step="0.01" value={step.maxDepth} onChange={(e) => u({ maxDepth: parseFloat(e.target.value) || 0 })} /></FieldRow>
    </>
  );
}

export function DrawDebugLinesEditor({ step }: { step: DrawDebugLinesStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const shaderOpts = resources.shaders.map((s) => ({ value: s.id, label: s.name }));
  return (
    <>
      <FieldRow label="Shader">
        <ResourceSelect value={step.shader ?? ''} onChange={(v) => u({ shader: v })} options={shaderOpts} />
      </FieldRow>
      <FieldRow label="Line Width">
        <Input type="number" step="0.5" value={step.lineWidth} onChange={(e) => u({ lineWidth: parseFloat(e.target.value) || 1 })} />
      </FieldRow>
    </>
  );
}
