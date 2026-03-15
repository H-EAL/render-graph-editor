import { useStore } from '../../../state/store';
import { Input } from '../../../components/ui/Input';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { FieldRow } from '../../../components/ui/Panel';
import type { DispatchComputeStep } from '../../../types';

export function DispatchComputeEditor({ step }: { step: DispatchComputeStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const computeShaders = resources.shaders.filter((s) => s.stage === 'compute').map((s) => ({ value: s.id, label: s.name }));

  return (
    <>
      <FieldRow label="Shader">
        <ResourceSelect value={step.shader} onChange={(v) => u({ shader: v })} options={computeShaders} />
      </FieldRow>
      <FieldRow label="Groups X">
        <Input value={String(step.groupsX)} onChange={(e) => u({ groupsX: e.target.value })} placeholder="1" />
      </FieldRow>
      <FieldRow label="Groups Y">
        <Input value={String(step.groupsY)} onChange={(e) => u({ groupsY: e.target.value })} placeholder="1" />
      </FieldRow>
      <FieldRow label="Groups Z">
        <Input value={String(step.groupsZ)} onChange={(e) => u({ groupsZ: e.target.value })} placeholder="1" />
      </FieldRow>
    </>
  );
}
