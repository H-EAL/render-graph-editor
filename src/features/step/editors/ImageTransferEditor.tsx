import { useStore } from '../../../state/store';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { Select } from '../../../components/ui/Select';
import { FieldRow } from '../../../components/ui/Panel';
import type { CopyImageStep, BlitImageStep, ResolveImageStep } from '../../../types';

type TransferStep = CopyImageStep | BlitImageStep | ResolveImageStep;

const FILTER_OPTS = [{ value: 'nearest', label: 'Nearest' }, { value: 'linear', label: 'Linear' }];

export function ImageTransferEditor({ step }: { step: TransferStep }) {
  const { updateStep, resources } = useStore();
  const u = (patch: object) => updateStep(step.id, patch as never);
  const rtOpts = resources.renderTargets.map((r) => ({ value: r.id, label: r.name }));

  return (
    <>
      <FieldRow label="Source">
        <ResourceSelect value={step.source} onChange={(v) => u({ source: v })} options={rtOpts} />
      </FieldRow>
      <FieldRow label="Destination">
        <ResourceSelect value={step.destination} onChange={(v) => u({ destination: v })} options={rtOpts} />
      </FieldRow>
      {step.type === 'blitImage' && (
        <FieldRow label="Filter">
          <Select options={FILTER_OPTS} value={(step as BlitImageStep).filter} onChange={(e) => u({ filter: e.target.value })} />
        </FieldRow>
      )}
    </>
  );
}
