import { useStore } from '../../../state/store';
import { useEffectiveResources } from '../../../utils/systemResources';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { FieldRow } from '../../../components/ui/Panel';
import type { FillBufferStep, GenerateMipChainStep } from '../../../types';

const FILTER_OPTS = [{ value: 'nearest', label: 'Nearest' }, { value: 'linear', label: 'Linear' }];

export function FillBufferEditor({ step }: { step: FillBufferStep }) {
  const { updateStep } = useStore();
  const resources = useEffectiveResources();
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
  const { updateStep } = useStore();
  const resources = useEffectiveResources();
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
