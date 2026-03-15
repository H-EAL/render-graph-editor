import { useStore } from '../../../state/store';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { FieldRow } from '../../../components/ui/Panel';
import type { DrawFullscreenStep } from '../../../types';

export function DrawFullscreenEditor({ step }: { step: DrawFullscreenStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const fsShaders = resources.shaders.filter((s) => s.stage === 'fragment').map((s) => ({ value: s.id, label: s.name }));
  const blendOpts = resources.blendStates.map((b) => ({ value: b.id, label: b.name }));

  return (
    <>
      <FieldRow label="Shader">
        <ResourceSelect value={step.shader} onChange={(v) => u({ shader: v })} options={fsShaders} />
      </FieldRow>
      <FieldRow label="Blend State">
        <ResourceSelect value={step.blendState ?? ''} onChange={(v) => u({ blendState: v })} options={blendOpts} />
      </FieldRow>
    </>
  );
}
