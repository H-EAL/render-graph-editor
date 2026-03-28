import { useStore } from '../../../state/store';
import { useEffectiveResources } from '../../../utils/systemResources';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import { Button } from '../../../components/ui/Button';
import { FieldRow } from '../../../components/ui/Panel';
import type { ClearImagesStep, ClearTarget } from '../../../types';

export function ClearImagesEditor({ step }: { step: ClearImagesStep }) {
  const { updateStep } = useStore();
  const resources = useEffectiveResources();
  const rtOpts = resources.renderTargets.map((r) => ({ value: r.id, label: r.name }));

  const updateTarget = (index: number, patch: Partial<ClearTarget>) => {
    const targets = step.targets.map((t, i) => (i === index ? { ...t, ...patch } : t));
    updateStep(step.id, { targets } as never);
  };

  const addTarget = () => {
    updateStep(step.id, {
      targets: [...step.targets, { target: '', clearValue: [0, 0, 0, 1] }],
    } as never);
  };

  const removeTarget = (index: number) => {
    updateStep(step.id, { targets: step.targets.filter((_, i) => i !== index) } as never);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {step.targets.map((t, i) => (
        <div key={i} className="bg-zinc-800/60 border border-zinc-700/50 rounded p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Target {i + 1}</span>
            <Button variant="ghost" size="icon" onClick={() => removeTarget(i)}>🗑</Button>
          </div>
          <FieldRow label="Target">
            <ResourceSelect value={t.target} onChange={(v) => updateTarget(i, { target: v })} options={rtOpts} />
          </FieldRow>
          <div className="grid grid-cols-[80px_1fr] gap-2 items-center px-3">
            <span className="text-xs text-zinc-500">Clear Value</span>
            <div className="flex gap-1">
              {t.clearValue.map((v, j) => (
                <input
                  key={j}
                  type="number"
                  step="0.01"
                  value={v}
                  onChange={(e) => {
                    const cv = [...t.clearValue] as [number, number, number, number];
                    cv[j] = parseFloat(e.target.value) || 0;
                    updateTarget(i, { clearValue: cv });
                  }}
                  className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1 focus:outline-none"
                />
              ))}
            </div>
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addTarget} className="self-start">+ Add Target</Button>
    </div>
  );
}
