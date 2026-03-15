import { useStore } from '../../state/store';
import { Input } from '../../components/ui/Input';
import { FieldRow, InspectorSection } from '../../components/ui/Panel';
import { TagsInput } from '../../components/ui/TagsInput';
import { MultiResourceSelect } from '../../components/ui/MultiResourceSelect';
import { DrawBatchEditor } from './editors/DrawBatchEditor';
import { DispatchComputeEditor } from './editors/DispatchComputeEditor';
import { DispatchRayTracingEditor } from './editors/DispatchRayTracingEditor';
import { DrawFullscreenEditor } from './editors/DrawFullscreenEditor';
import { ImageTransferEditor } from './editors/ImageTransferEditor';
import { ClearImagesEditor } from './editors/ClearImagesEditor';
import { FillBufferEditor, GenerateMipChainEditor, ViewportEditor, DrawDebugLinesEditor } from './editors/SimpleTargetEditor';
import type { Step } from '../../types';

function StepTypeEditor({ step }: { step: Step }) {
  switch (step.type) {
    case 'drawBatch':
    case 'drawBatchWithMaterials':
      return <DrawBatchEditor step={step} />;
    case 'dispatchCompute':
      return <DispatchComputeEditor step={step} />;
    case 'dispatchRayTracing':
      return <DispatchRayTracingEditor step={step} />;
    case 'drawFullscreen':
      return <DrawFullscreenEditor step={step} />;
    case 'copyImage':
    case 'blitImage':
    case 'resolveImage':
      return <ImageTransferEditor step={step} />;
    case 'clearImages':
      return <ClearImagesEditor step={step} />;
    case 'fillBuffer':
      return <FillBufferEditor step={step} />;
    case 'generateMipChain':
      return <GenerateMipChainEditor step={step} />;
    case 'viewport':
      return <ViewportEditor step={step} />;
    case 'drawDebugLines':
      return <DrawDebugLinesEditor step={step} />;
    default:
      return <div className="p-3 text-xs text-zinc-500">No editor for this step type.</div>;
  }
}

export function StepInspector() {
  const { pipeline, resources, selectedStepId, updateStep, selectStep } = useStore();
  const step = selectedStepId ? pipeline.steps[selectedStepId] : null;

  const parentPass = step
    ? Object.values(pipeline.passes).find((p) => p.steps.includes(step.id)) ?? null
    : null;

  if (!step) {
    return <div className="p-4 text-xs text-zinc-500">Select a step to inspect.</div>;
  }

  const allResources = [
    ...resources.renderTargets.map((r) => ({ value: r.id, label: r.name })),
    ...resources.buffers.map((b) => ({ value: b.id, label: b.name })),
  ];

  const u = (patch: object) => updateStep(step.id, patch as never);

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {parentPass && (
        <button
          onClick={() => selectStep(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 border-b border-zinc-800 transition-colors text-left shrink-0">
          <span>◂</span>
          <span className="truncate">{parentPass.name}</span>
        </button>
      )}
      <InspectorSection title="Identity">
        <FieldRow label="Name">
          <Input value={step.name} onChange={(e) => u({ name: e.target.value })} />
        </FieldRow>
        <FieldRow label="Type">
          <span className="text-xs font-mono text-zinc-300">{step.type}</span>
        </FieldRow>
      </InspectorSection>

      <InspectorSection title={`${step.type} Settings`}>
        <StepTypeEditor step={step} />
      </InspectorSection>

      <InspectorSection title="Resources">
        <div className="p-3 flex flex-col gap-3">
          <MultiResourceSelect
            label="Reads"
            values={step.reads}
            onChange={(v) => u({ reads: v })}
            options={allResources}
            placeholder="Add read resource"
          />
          <MultiResourceSelect
            label="Writes"
            values={step.writes}
            onChange={(v) => u({ writes: v })}
            options={allResources}
            placeholder="Add write resource"
          />
        </div>
      </InspectorSection>

      <InspectorSection title="Conditions">
        <div className="p-3">
          <TagsInput
            values={step.conditions}
            onChange={(v) => u({ conditions: v })}
            placeholder="Add condition flag"
          />
        </div>
      </InspectorSection>
    </div>
  );
}
