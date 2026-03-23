import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
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
import type { RasterStep, RasterCommand, EnableIfCommand, PassId, StepId } from '../../types';

const DRAW_TYPE_ABBR: Record<string, string> = { batch: 'DRAW', batchWithMaterials: 'MAT', fullscreen: 'FS', debugLines: 'DBG' };

function cmdAbbr(cmd: RasterCommand): string {
  if (cmd.type === 'drawBatch') return DRAW_TYPE_ABBR[cmd.drawType ?? 'batch'] ?? 'DRAW';
  if (cmd.type === 'enableIf') return 'IF';
  return 'DYN';
}

function cmdCls(cmd: RasterCommand): string {
  if (cmd.type === 'drawBatch') return 'bg-blue-900/70 text-blue-300 border-blue-800/50';
  if (cmd.type === 'enableIf') return 'bg-teal-900/60 text-teal-300 border-teal-700/50';
  return 'bg-zinc-700/60 text-zinc-400 border-zinc-600/40';
}

// ─── Single command row (sortable) ────────────────────────────────────────────

interface CommandRowProps {
  cmd: RasterCommand;
  stepId: StepId;
  isSelected: boolean;
}

function CommandRow({ cmd, stepId, isSelected }: CommandRowProps) {
  const { selectStep, selectCommand, deleteRasterCommand, duplicateRasterCommand } = useStore();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cmd.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const handleClick = () => {
    selectStep(stepId);
    selectCommand(isSelected ? null : cmd.id);
  };

  const abbr = cmdAbbr(cmd);
  const cls  = cmdCls(cmd);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className={`group flex items-center gap-2 pl-6 pr-2 py-1.5 cursor-pointer border-b border-zinc-800/40 hover:bg-zinc-800/30 select-none
        ${isSelected ? 'bg-blue-900/20 border-l-2 border-l-blue-400' : 'border-l-2 border-l-transparent'}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-700 hover:text-zinc-500 cursor-grab active:cursor-grabbing p-0.5 shrink-0 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </button>

      <span className={`text-[9px] font-mono px-1 py-0.5 rounded border shrink-0 ${cls}`}>
        {abbr}
      </span>

      <span className="flex-1 text-xs text-zinc-300 truncate">{cmd.name}</span>

      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => duplicateRasterCommand(stepId, cmd.id)}
          title="Duplicate"
          className="p-0.5 text-zinc-600 hover:text-zinc-300 text-xs rounded"
        >⧉</button>
        <button
          onClick={() => deleteRasterCommand(stepId, cmd.id)}
          title="Delete"
          className="p-0.5 text-zinc-600 hover:text-red-400 text-xs rounded"
        >✕</button>
      </div>
    </div>
  );
}

// ─── Enable-If command block ──────────────────────────────────────────────────

function EnableIfCommandBlock({ cmd, stepId }: { cmd: EnableIfCommand; stepId: StepId }) {
  const { selectedCommandId, selectStep, selectCommand, deleteRasterCommand, addCommandToEnableIf } = useStore();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const isSelected = selectedCommandId === cmd.id;

  const CHILD_OPTIONS: { type: RasterCommandType; drawType?: DrawBatchType; label: string }[] = [
    { type: 'setDynamicState',                             label: 'Set Dynamic State' },
    { type: 'drawBatch', drawType: 'batch',                label: 'Draw Batch' },
    { type: 'drawBatch', drawType: 'batchWithMaterials',   label: 'Draw Batch (Materials)' },
    { type: 'drawBatch', drawType: 'fullscreen',           label: 'Draw Fullscreen' },
    { type: 'drawBatch', drawType: 'debugLines',           label: 'Draw Debug Lines' },
  ];

  return (
    <div className="border-b border-zinc-800/40">
      {/* Header row */}
      <div
        onClick={() => { selectStep(stepId); selectCommand(isSelected ? null : cmd.id); }}
        className={`group flex items-center gap-2 pl-6 pr-2 py-1.5 cursor-pointer hover:bg-zinc-800/30 select-none border-l-2
          ${isSelected ? 'bg-teal-900/10 border-l-teal-400' : 'border-l-transparent'}`}
      >
        <span className="text-[9px] font-mono px-1 py-0.5 rounded border shrink-0 bg-teal-900/60 text-teal-300 border-teal-700/50">IF</span>
        <span className="flex-1 text-xs text-zinc-300 truncate">{cmd.name}</span>
        {cmd.condition && (
          <span className="text-[9px] text-teal-500 font-mono truncate max-w-24" title={cmd.condition}>{cmd.condition}</span>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => deleteRasterCommand(stepId, cmd.id)} className="p-0.5 text-zinc-600 hover:text-red-400 text-xs rounded">✕</button>
        </div>
      </div>

      {/* Children */}
      <div className="pl-4 border-l border-teal-900/40 ml-6">
        {cmd.thenCommands.length === 0 && (
          <div className="px-3 py-1 text-[10px] text-zinc-700 italic">No commands.</div>
        )}
        {cmd.thenCommands.map((child) => (
          <CommandRow key={child.id} cmd={child} stepId={stepId} isSelected={selectedCommandId === child.id} />
        ))}
        {/* Add child */}
        <div className="relative px-2 py-1">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 border border-dashed border-zinc-700/40 hover:border-zinc-600 rounded px-2 py-0.5 w-full text-left"
          >+ Add</button>
          {showAddMenu && (
            <div className="absolute left-2 top-full z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44 overflow-hidden">
              {CHILD_OPTIONS.map(({ type, drawType, label }) => (
                <button
                  key={label}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  onClick={() => { addCommandToEnableIf(stepId, cmd.id, type, drawType); setShowAddMenu(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Attachment summary chip ───────────────────────────────────────────────────

function AttachmentSummary({ step }: { step: RasterStep }) {
  const { resources } = useStore();
  const colorCount = step.attachments.colorAttachments.length;
  const hasDepth   = !!step.attachments.depthAttachment;

  const names = step.attachments.colorAttachments
    .map((a) => resources.renderTargets.find((r) => r.id === a.target)?.name ?? a.target)
    .filter(Boolean);

  return (
    <div className="flex items-center gap-1.5 px-6 py-1 border-b border-zinc-800/30 text-[10px] text-zinc-600 flex-wrap">
      {colorCount === 0 && !hasDepth ? (
        <span className="italic">No attachments</span>
      ) : (
        <>
          {names.map((n) => (
            <span key={n} className="bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 rounded px-1 font-mono">{n}</span>
          ))}
          {hasDepth && (
            <span className="bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 rounded px-1 font-mono">
              {resources.renderTargets.find((r) => r.id === step.attachments.depthAttachment!.target)?.name ?? 'depth'}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main block ────────────────────────────────────────────────────────────────

import type { DrawBatchType } from '../../types';

import type { RasterCommandType } from '../../types';

const CMD_TYPE_OPTIONS: { type: RasterCommandType; drawType?: DrawBatchType; label: string }[] = [
  { type: 'setDynamicState',                              label: 'Set Dynamic State' },
  { type: 'drawBatch', drawType: 'batch',                 label: 'Draw Batch' },
  { type: 'drawBatch', drawType: 'batchWithMaterials',    label: 'Draw Batch (Materials)' },
  { type: 'drawBatch', drawType: 'fullscreen',            label: 'Draw Fullscreen' },
  { type: 'drawBatch', drawType: 'debugLines',            label: 'Draw Debug Lines' },
  { type: 'enableIf',                                     label: 'Enable If' },
];

interface RasterStepBlockProps {
  passId: PassId;
  stepId: StepId;
}

export function RasterStepBlock({ passId, stepId }: RasterStepBlockProps) {
  const {
    pipeline, selectedStepId, selectedCommandId,
    selectStep, selectCommand,
    addRasterCommand, reorderRasterCommands,
    deleteStep, duplicateStep,
  } = useStore();

  const step = pipeline.steps[stepId] as RasterStep | undefined;
  const [expanded, setExpanded] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const isStepSelected = selectedStepId === stepId;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const sortableStyle = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!step || step.type !== 'raster') return null;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = step.commands.findIndex((c) => c.id === active.id);
    const newIdx = step.commands.findIndex((c) => c.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) {
      reorderRasterCommands(stepId, arrayMove(step.commands, oldIdx, newIdx));
    }
  };

  const handleHeaderClick = () => {
    if (isStepSelected) {
      selectCommand(null);
    } else {
      selectStep(stepId);
      selectCommand(null);
    }
  };

  const colorCount = step.attachments.colorAttachments.length;
  const hasDepth   = !!step.attachments.depthAttachment;

  return (
    <div ref={setNodeRef} style={sortableStyle} className={`border-b border-zinc-800/50 ${isStepSelected ? 'border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'}`}>
      {/* ── Header ── */}
      <div
        onClick={handleHeaderClick}
        className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/40 select-none
          ${isStepSelected && !selectedCommandId ? 'bg-blue-900/25' : ''}`}
      >
        {/* drag handle */}
        <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>

        {/* expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-zinc-600 hover:text-zinc-400 text-[10px] w-3 shrink-0"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Raster badge */}
        <span className="text-[9px] font-mono bg-blue-900/60 text-blue-300 border border-blue-700/50 rounded px-1 py-0.5 shrink-0">
          Raster
        </span>

        <span className="flex-1 text-sm text-zinc-200 truncate">{step.name}</span>

        {/* attachment quick-info */}
        <span className="text-[10px] text-zinc-600 shrink-0">
          {colorCount}C{hasDepth ? '+D' : ''}
        </span>

        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => duplicateStep(passId, stepId)} title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200 rounded text-xs">⧉</button>
          <button onClick={() => deleteStep(passId, stepId)} title="Delete" className="p-1 text-zinc-500 hover:text-red-400 rounded text-xs">✕</button>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <>
          <AttachmentSummary step={step} />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={step.commands.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {step.commands.map((cmd) =>
                cmd.type === 'enableIf' ? (
                  <EnableIfCommandBlock key={cmd.id} cmd={cmd} stepId={stepId} />
                ) : (
                  <CommandRow
                    key={cmd.id}
                    cmd={cmd}
                    stepId={stepId}
                    isSelected={selectedCommandId === cmd.id && isStepSelected}
                  />
                )
              )}
            </SortableContext>
          </DndContext>

          {step.commands.length === 0 && (
            <div className="pl-6 pr-3 py-1.5 text-[10px] text-zinc-700 italic">No commands yet.</div>
          )}

          {/* ── Add command ── */}
          <div className="relative pl-6 pr-3 py-1.5">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 border border-dashed border-zinc-700/60 hover:border-zinc-600 rounded px-2 py-0.5 w-full text-left"
            >
              + Add Command
            </button>
            {showAddMenu && (
              <div className="absolute left-6 top-full z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44 overflow-hidden">
                {CMD_TYPE_OPTIONS.map(({ type, drawType, label }) => (
                  <button
                    key={label}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                    onClick={() => {
                      addRasterCommand(stepId, type, drawType);
                      selectStep(stepId);
                      setShowAddMenu(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
