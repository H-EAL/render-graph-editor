import { useStore } from '../../../state/store';
import { Input } from '../../../components/ui/Input';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { FieldRow } from '../../../components/ui/Panel';
import type { DispatchRayTracingStep } from '../../../types';

export function DispatchRayTracingEditor({ step }: { step: DispatchRayTracingStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const rtShaders = resources.shaders
    .filter((s) => ['raygen', 'miss', 'closesthit'].includes(s.stage))
    .map((s) => ({ value: s.id, label: `${s.name} (${s.stage})` }));

  return (
    <>
      <FieldRow label="Raygen Shader">
        <ResourceSelect value={step.raygenShader} onChange={(v) => u({ raygenShader: v })} options={rtShaders} />
      </FieldRow>
      <FieldRow label="Miss Shader">
        <ResourceSelect value={step.missShader ?? ''} onChange={(v) => u({ missShader: v })} options={rtShaders} />
      </FieldRow>
      <FieldRow label="ClosestHit">
        <ResourceSelect value={step.closestHitShader ?? ''} onChange={(v) => u({ closestHitShader: v })} options={rtShaders} />
      </FieldRow>
      <FieldRow label="Width">
        <Input value={String(step.width)} onChange={(e) => u({ width: e.target.value })} placeholder="viewport.width" />
      </FieldRow>
      <FieldRow label="Height">
        <Input value={String(step.height)} onChange={(e) => u({ height: e.target.value })} placeholder="viewport.height" />
      </FieldRow>
    </>
  );
}
