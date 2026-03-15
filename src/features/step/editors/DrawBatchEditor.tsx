import { useStore } from '../../../state/store';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { FieldRow } from '../../../components/ui/Panel';
import type { DrawBatchStep, DrawBatchWithMaterialsStep } from '../../../types';

interface Props {
  step: DrawBatchStep | DrawBatchWithMaterialsStep;
}

const CULL_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
];

export function DrawBatchEditor({ step }: Props) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);

  const shaderOpts = resources.shaders.map((s) => ({ value: s.id, label: s.name }));
  const blendOpts = resources.blendStates.map((b) => ({ value: b.id, label: b.name }));

  return (
    <>
      <FieldRow label="Shader">
        <ResourceSelect value={step.shader} onChange={(v) => u({ shader: v })} options={shaderOpts} />
      </FieldRow>
      <FieldRow label="Blend State">
        <ResourceSelect value={step.blendState ?? ''} onChange={(v) => u({ blendState: v })} options={blendOpts} />
      </FieldRow>
      <FieldRow label="Depth Test">
        <input type="checkbox" checked={step.depthTest} onChange={(e) => u({ depthTest: e.target.checked })}
          className="w-4 h-4 accent-blue-500 cursor-pointer" />
      </FieldRow>
      <FieldRow label="Depth Write">
        <input type="checkbox" checked={step.depthWrite} onChange={(e) => u({ depthWrite: e.target.checked })}
          className="w-4 h-4 accent-blue-500 cursor-pointer" />
      </FieldRow>
      <FieldRow label="Cull Mode">
        <Select options={CULL_OPTIONS} value={step.cullMode} onChange={(e) => u({ cullMode: e.target.value })} />
      </FieldRow>
      <FieldRow label="Batch Tag">
        <Input value={step.batchTag ?? ''} onChange={(e) => u({ batchTag: e.target.value })} placeholder="e.g. Opaque" />
      </FieldRow>
      {step.type === 'drawBatchWithMaterials' && (
        <FieldRow label="Material Set">
          <Input value={(step as DrawBatchWithMaterialsStep).materialSet ?? ''} onChange={(e) => u({ materialSet: e.target.value })} placeholder="e.g. Default" />
        </FieldRow>
      )}
    </>
  );
}
