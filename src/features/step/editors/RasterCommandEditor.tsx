import { useStore } from '../../../state/store';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { FieldRow } from '../../../components/ui/Panel';
import { ResourceSelect } from '../../../components/ui/ResourceSelect';
import type { RasterCommand, SetDynamicStateCommand, DrawBatchCommand, StepId, CommandId, DynamicStateType } from '../../../types';

const DYNAMIC_STATE_OPTIONS: { value: DynamicStateType; label: string }[] = [
  { value: 'viewport',   label: 'Viewport' },
  { value: 'scissor',    label: 'Scissor' },
  { value: 'depthBias',  label: 'Depth Bias' },
  { value: 'stencilRef', label: 'Stencil Ref' },
];

const CULL_MODE_OPTIONS = [
  { value: 'none',  label: 'None' },
  { value: 'front', label: 'Front' },
  { value: 'back',  label: 'Back' },
];

function SetDynamicStateEditor({ cmd, stepId }: { cmd: SetDynamicStateCommand; stepId: StepId }) {
  const { updateRasterCommand } = useStore();
  const u = (patch: Partial<SetDynamicStateCommand>) =>
    updateRasterCommand(stepId, cmd.id, patch as Partial<RasterCommand>);

  return (
    <>
      <FieldRow label="State Type">
        <Select
          options={DYNAMIC_STATE_OPTIONS}
          value={cmd.stateType}
          onChange={(e) => u({ stateType: e.target.value as DynamicStateType })}
        />
      </FieldRow>

      {(cmd.stateType === 'viewport' || cmd.stateType === 'scissor') && (
        <>
          <FieldRow label="X / Y">
            <div className="flex gap-1">
              <input
                type="number" value={cmd.x ?? 0}
                onChange={(e) => u({ x: parseFloat(e.target.value) || 0 })}
                className="w-16 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
              />
              <input
                type="number" value={cmd.y ?? 0}
                onChange={(e) => u({ y: parseFloat(e.target.value) || 0 })}
                className="w-16 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
              />
            </div>
          </FieldRow>
          <FieldRow label="Width">
            <Input value={String(cmd.width ?? 'viewport.width')} onChange={(e) => u({ width: e.target.value })} />
          </FieldRow>
          <FieldRow label="Height">
            <Input value={String(cmd.height ?? 'viewport.height')} onChange={(e) => u({ height: e.target.value })} />
          </FieldRow>
        </>
      )}

      {cmd.stateType === 'viewport' && (
        <FieldRow label="Depth Range">
          <div className="flex gap-1 items-center">
            <input
              type="number" step="0.01" value={cmd.minDepth ?? 0}
              onChange={(e) => u({ minDepth: parseFloat(e.target.value) || 0 })}
              className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
              title="Min depth"
            />
            <span className="text-zinc-600 text-xs">–</span>
            <input
              type="number" step="0.01" value={cmd.maxDepth ?? 1}
              onChange={(e) => u({ maxDepth: parseFloat(e.target.value) || 0 })}
              className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
              title="Max depth"
            />
          </div>
        </FieldRow>
      )}

      {cmd.stateType === 'depthBias' && (
        <>
          <FieldRow label="Constant Factor">
            <input
              type="number" step="0.001" value={cmd.constantFactor ?? 0}
              onChange={(e) => u({ constantFactor: parseFloat(e.target.value) || 0 })}
              className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
            />
          </FieldRow>
          <FieldRow label="Clamp">
            <input
              type="number" step="0.001" value={cmd.clamp ?? 0}
              onChange={(e) => u({ clamp: parseFloat(e.target.value) || 0 })}
              className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
            />
          </FieldRow>
          <FieldRow label="Slope Factor">
            <input
              type="number" step="0.001" value={cmd.slopeFactor ?? 0}
              onChange={(e) => u({ slopeFactor: parseFloat(e.target.value) || 0 })}
              className="w-24 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
            />
          </FieldRow>
        </>
      )}

      {cmd.stateType === 'stencilRef' && (
        <FieldRow label="Reference">
          <input
            type="number" value={cmd.reference ?? 0}
            onChange={(e) => u({ reference: parseInt(e.target.value) || 0 })}
            className="w-20 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
          />
        </FieldRow>
      )}
    </>
  );
}

function DrawBatchEditor({ cmd, stepId }: { cmd: DrawBatchCommand; stepId: StepId }) {
  const { updateRasterCommand, resources } = useStore();
  const shaderOpts = resources.shaders.map((s) => ({ value: s.id, label: s.name }));
  const blendOpts  = resources.blendStates.map((b) => ({ value: b.id, label: b.name }));

  const u = (patch: Partial<DrawBatchCommand>) =>
    updateRasterCommand(stepId, cmd.id, patch as Partial<RasterCommand>);

  return (
    <>
      <FieldRow label="Shader">
        <ResourceSelect value={cmd.shader} onChange={(v) => u({ shader: v })} options={shaderOpts} />
      </FieldRow>
      <FieldRow label="Blend State">
        <ResourceSelect value={cmd.blendState ?? ''} onChange={(v) => u({ blendState: v })} options={blendOpts} />
      </FieldRow>
      <FieldRow label="Cull Mode">
        <Select options={CULL_MODE_OPTIONS} value={cmd.cullMode} onChange={(e) => u({ cullMode: e.target.value as DrawBatchCommand['cullMode'] })} />
      </FieldRow>
      <FieldRow label="Depth Test">
        <input type="checkbox" checked={cmd.depthTest} onChange={(e) => u({ depthTest: e.target.checked })} className="w-4 h-4 accent-blue-500 cursor-pointer" />
      </FieldRow>
      <FieldRow label="Depth Write">
        <input type="checkbox" checked={cmd.depthWrite} onChange={(e) => u({ depthWrite: e.target.checked })} className="w-4 h-4 accent-blue-500 cursor-pointer" />
      </FieldRow>
      <FieldRow label="With Materials">
        <input type="checkbox" checked={cmd.withMaterials ?? false} onChange={(e) => u({ withMaterials: e.target.checked })} className="w-4 h-4 accent-blue-500 cursor-pointer" />
      </FieldRow>
      {cmd.withMaterials && (
        <FieldRow label="Material Set">
          <Input value={cmd.materialSet ?? ''} onChange={(e) => u({ materialSet: e.target.value })} placeholder="material set tag" />
        </FieldRow>
      )}
      <FieldRow label="Batch Tag">
        <Input value={cmd.batchTag ?? ''} onChange={(e) => u({ batchTag: e.target.value })} placeholder="optional tag" />
      </FieldRow>
    </>
  );
}

interface RasterCommandEditorProps {
  stepId: StepId;
  commandId: CommandId;
  command: RasterCommand;
}

export function RasterCommandEditor({ stepId, commandId, command }: RasterCommandEditorProps) {
  const { updateRasterCommand } = useStore();
  const u = (patch: Partial<RasterCommand>) => updateRasterCommand(stepId, commandId, patch);

  return (
    <div className="flex flex-col gap-0">
      <FieldRow label="Name">
        <Input value={command.name} onChange={(e) => u({ name: e.target.value })} />
      </FieldRow>

      {command.type === 'setDynamicState' && (
        <SetDynamicStateEditor cmd={command} stepId={stepId} />
      )}
      {command.type === 'drawBatch' && (
        <DrawBatchEditor cmd={command} stepId={stepId} />
      )}
    </div>
  );
}
