import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../state/store';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { PassId, StepId, StepType } from '../../types';

const STEP_TYPES: { type: StepType; label: string }[] = [
  { type: 'drawBatch', label: 'Draw Batch' },
  { type: 'drawBatchWithMaterials', label: 'Draw Batch (Materials)' },
  { type: 'dispatchCompute', label: 'Dispatch Compute' },
  { type: 'dispatchRayTracing', label: 'Dispatch Ray Tracing' },
  { type: 'drawFullscreen', label: 'Draw Fullscreen' },
  { type: 'copyImage', label: 'Copy Image' },
  { type: 'blitImage', label: 'Blit Image' },
  { type: 'resolveImage', label: 'Resolve Image' },
  { type: 'clearImages', label: 'Clear Images' },
  { type: 'fillBuffer', label: 'Fill Buffer' },
  { type: 'generateMipChain', label: 'Generate Mip Chain' },
  { type: 'viewport', label: 'Viewport' },
  { type: 'drawDebugLines', label: 'Draw Debug Lines' },
];

interface StepRowProps {
  passId: PassId;
  stepId: StepId;
}

function StepRow({ passId, stepId }: StepRowProps) {
  const { pipeline, selectedStepId, selectStep, deleteStep, duplicateStep } = useStore();
  const step = pipeline.steps[stepId];
  const isSelected = selectedStepId === stepId;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => selectStep(isSelected ? null : stepId)}
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/40 select-none
        ${isSelected ? 'bg-blue-900/25 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </button>

      <Badge value={step.type} />

      <span className="flex-1 text-sm text-zinc-200 truncate">{step.name}</span>

      {step.conditions.length > 0 && (
        <span className="text-[10px] text-amber-400/70 shrink-0">{step.conditions.length} cond</span>
      )}

      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => duplicateStep(passId, stepId)}
          title="Duplicate step"
          className="p-1 text-zinc-500 hover:text-zinc-200 rounded"
        >⧉</button>
        <button
          onClick={() => deleteStep(passId, stepId)}
          title="Delete step"
          className="p-1 text-zinc-500 hover:text-red-400 rounded"
        >✕</button>
      </div>
    </div>
  );
}

interface StepListProps {
  passId: PassId;
}

export function StepList({ passId }: StepListProps) {
  const { pipeline, addStep, reorderSteps } = useStore();
  const [showAddMenu, setShowAddMenu] = useState(false);

  const pass = pipeline.passes[passId];
  if (!pass) return null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = pass.steps.indexOf(active.id as StepId);
      const newIdx = pass.steps.indexOf(over.id as StepId);
      reorderSteps(passId, arrayMove(pass.steps, oldIdx, newIdx));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Steps ({pass.steps.length})
        </span>
        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setShowAddMenu(!showAddMenu)}>
            + Add Step
          </Button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-52 overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                {STEP_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                    onClick={() => {
                      addStep(passId, type);
                      setShowAddMenu(false);
                    }}
                  >
                    <Badge value={type} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {pass.steps.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-600">
            No steps yet. Click "Add Step" to begin.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pass.steps} strategy={verticalListSortingStrategy}>
              {pass.steps.map((sid) => (
                <StepRow key={sid} passId={passId} stepId={sid} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
