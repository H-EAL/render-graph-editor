import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
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
import { RasterStepBlock } from './RasterStepBlock';
import type { PassId, StepId, StepType, VariantId, IfBlockStep } from '../../types';

const STEP_TYPES: { type: StepType; label: string }[] = [
  { type: 'raster',              label: 'Raster' },
  { type: 'dispatchCompute',     label: 'Dispatch Compute' },
  { type: 'dispatchRayTracing',  label: 'Dispatch Ray Tracing' },
  { type: 'copyImage',           label: 'Copy Image' },
  { type: 'blitImage',           label: 'Blit Image' },
  { type: 'resolveImage',        label: 'Resolve Image' },
  { type: 'clearImages',         label: 'Clear Images' },
  { type: 'fillBuffer',          label: 'Fill Buffer' },
  { type: 'generateMipChain',    label: 'Generate Mip Chain' },
  { type: 'ifBlock',             label: 'If Block' },
];

/** Types allowed inside IfBlock branches (no nested IfBlocks). */
const BRANCH_STEP_TYPES = STEP_TYPES.filter((t) => t.type !== 'ifBlock');

const CONTAINER_ACTIVE   = 'active';
const CONTAINER_FALLBACK = 'fallback';

// ─── IfBlock branch list ──────────────────────────────────────────────────────

interface IfBranchListProps {
  passId: PassId;
  ifBlockId: StepId;
  branch: 'then' | 'else';
}

function IfBranchList({ passId, ifBlockId, branch }: IfBranchListProps) {
  const { pipeline, selectedStepId, selectStep, addStepToIfBranch, deleteStepFromIfBranch, reorderIfBranch } = useStore();
  const [showMenu, setShowMenu] = useState(false);

  const ifStep = pipeline.steps[ifBlockId] as IfBlockStep | undefined;
  if (!ifStep || ifStep.type !== 'ifBlock') return null;
  const stepIds = branch === 'then' ? ifStep.thenSteps : ifStep.elseSteps;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oi = stepIds.indexOf(active.id as StepId);
      const ni = stepIds.indexOf(over.id as StepId);
      if (oi !== -1 && ni !== -1) reorderIfBranch(ifBlockId, branch, arrayMove(stepIds, oi, ni));
    }
  };

  const label = branch === 'then' ? 'THEN' : 'ELSE';
  const headerCls = branch === 'then' ? 'bg-green-950/20 text-green-400/80' : 'bg-orange-950/20 text-orange-400/80';

  return (
    <div>
      <div className={`flex items-center gap-2 px-2 py-1 ${headerCls}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-zinc-600">{stepIds.length} step{stepIds.length !== 1 ? 's' : ''}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
          {stepIds.length === 0 ? (
            <div className="px-4 py-1.5 text-[10px] text-zinc-600 italic">No steps.</div>
          ) : (
            stepIds.map((sid) => {
              const step = pipeline.steps[sid];
              if (!step) return null;
              return (
                <BranchStepRow
                  key={sid}
                  passId={passId}
                  stepId={sid}
                  isSelected={selectedStepId === sid}
                  onSelect={() => selectStep(selectedStepId === sid ? null : sid)}
                  onDelete={() => deleteStepFromIfBranch(ifBlockId, branch, sid)}
                />
              );
            })
          )}
        </SortableContext>
      </DndContext>
      <div className="relative px-2 py-1 border-t border-zinc-800/40">
        <button className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1" onClick={() => setShowMenu(!showMenu)}>
          + Add
        </button>
        {showMenu && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-48 overflow-hidden">
            <div className="max-h-52 overflow-y-auto">
              {BRANCH_STEP_TYPES.map(({ type, label: lbl }) => (
                <button key={type} className="w-full text-left px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                  onClick={() => { addStepToIfBranch(ifBlockId, branch, type); setShowMenu(false); }}>
                  <Badge value={type} /><span>{lbl}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Branch step row (inside IfBlock) ─────────────────────────────────────────

interface BranchStepRowProps {
  passId: PassId;
  stepId: StepId;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function BranchStepRow({ passId, stepId, isSelected, onSelect, onDelete }: BranchStepRowProps) {
  const { pipeline } = useStore();
  const step = pipeline.steps[stepId];
  const pass = pipeline.passes[passId];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  if (!step) return null;
  const stepOnlyConds = step.conditions.filter((c) => !(pass?.conditions ?? []).includes(c));
  return (
    <div ref={setNodeRef} style={style} onClick={onSelect}
      className={`group flex items-center gap-1.5 pl-5 pr-3 py-1.5 cursor-pointer border-b border-zinc-800/40 hover:bg-zinc-800/30 select-none
        ${isSelected ? 'bg-blue-900/20 border-l-2 border-l-blue-400' : 'border-l-2 border-l-transparent'}`}>
      <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
      <Badge value={step.type} />
      <span className="flex-1 text-xs text-zinc-300 truncate">{step.name}</span>
      {stepOnlyConds.length > 0 && (
        <span className="text-[9px] bg-amber-950/60 text-amber-400 border border-amber-800/50 rounded px-1 font-mono leading-4">
          {stepOnlyConds[0]}{stepOnlyConds.length > 1 ? ` +${stepOnlyConds.length - 1}` : ''}
        </span>
      )}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button onClick={onDelete} title="Delete" className="p-0.5 text-zinc-500 hover:text-red-400 rounded text-xs">✕</button>
      </div>
    </div>
  );
}

// ─── IfBlock row ──────────────────────────────────────────────────────────────

interface IfBlockRowProps {
  passId: PassId;
  stepId: StepId;
  onDelete: () => void;
}

function IfBlockRow({ passId, stepId, onDelete }: IfBlockRowProps) {
  const { pipeline, selectedStepId, selectStep, duplicateStep, updateIfBlockCondition } = useStore();
  const step = pipeline.steps[stepId] as IfBlockStep | undefined;
  const isSelected = selectedStepId === stepId;
  const [expanded, setExpanded] = useState(true);
  const [editingCond, setEditingCond] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step || step.type !== 'ifBlock') return null;

  return (
    <div ref={setNodeRef} style={style}
      className={`group border-b border-zinc-800/50 border-l-2 ${isSelected ? 'border-l-purple-500' : 'border-l-transparent'}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-zinc-800/40 ${isSelected ? 'bg-purple-900/20' : ''}`}
        onClick={() => selectStep(isSelected ? null : stepId)}>
        <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
        <button className="text-zinc-500 hover:text-zinc-300 shrink-0 text-xs w-3"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider shrink-0">if</span>
        {editingCond ? (
          <input autoFocus className="flex-1 bg-zinc-800 border border-purple-600/60 text-zinc-200 text-xs rounded px-2 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
            value={step.condition}
            onChange={(e) => updateIfBlockCondition(stepId, e.target.value)}
            onBlur={() => setEditingCond(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingCond(false); }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex-1 text-xs font-mono text-purple-300/90 truncate cursor-text hover:text-purple-200"
            onClick={(e) => { e.stopPropagation(); setEditingCond(true); }} title="Click to edit condition">
            {step.condition || <em className="text-zinc-600 not-italic">click to set condition…</em>}
          </span>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => duplicateStep(passId, stepId)} title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200 rounded">⧉</button>
          <button onClick={onDelete} title="Delete" className="p-1 text-zinc-500 hover:text-red-400 rounded">✕</button>
        </div>
      </div>
      {/* Branches */}
      {expanded && (
        <div className="ml-4 border-l-2 border-purple-800/30">
          <div className="border-b border-zinc-800/40">
            <IfBranchList passId={passId} ifBlockId={stepId} branch="then" />
          </div>
          <IfBranchList passId={passId} ifBlockId={stepId} branch="else" />
        </div>
      )}
    </div>
  );
}

// ─── Generic step row ─────────────────────────────────────────────────────────

interface StepRowProps {
  passId: PassId;
  stepId: StepId;
  onDelete: () => void;
  onDuplicate: () => void;
}

function StepRow({ passId, stepId, onDelete, onDuplicate }: StepRowProps) {
  const { pipeline, selectedStepId, selectStep } = useStore();
  const step = pipeline.steps[stepId];
  const pass = pipeline.passes[passId];
  const isSelected = selectedStepId === stepId;
  const stepOnlyConds = step?.conditions.filter((c) => !(pass?.conditions ?? []).includes(c)) ?? [];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step) return null;

  return (
    <div ref={setNodeRef} style={style} onClick={() => selectStep(isSelected ? null : stepId)}
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/40 select-none
        ${isSelected ? 'bg-blue-900/25 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'}`}>
      <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
      <Badge value={step.type} />
      <span className="flex-1 text-sm text-zinc-200 truncate">{step.name}</span>
      {stepOnlyConds.length > 0 && (
        <div className="flex items-center gap-0.5 shrink-0">
          {stepOnlyConds.slice(0, 2).map((c) => (
            <span key={c} className="text-[9px] bg-amber-950/60 text-amber-400 border border-amber-800/50 rounded px-1 font-mono leading-4">{c}</span>
          ))}
          {stepOnlyConds.length > 2 && <span className="text-[9px] text-amber-600/70 font-mono">+{stepOnlyConds.length - 2}</span>}
        </div>
      )}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button onClick={onDuplicate} title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200 rounded">⧉</button>
        <button onClick={onDelete}    title="Delete"    className="p-1 text-zinc-500 hover:text-red-400 rounded">✕</button>
      </div>
    </div>
  );
}

// ─── Render a step (dispatches to correct component) ─────────────────────────

function RenderStep({ passId, sid, onDelete, onDuplicate }: { passId: PassId; sid: StepId; onDelete: () => void; onDuplicate: () => void }) {
  const { pipeline } = useStore();
  const step = pipeline.steps[sid];
  if (!step) return null;
  if (step.type === 'raster') return <RasterStepBlock passId={passId} stepId={sid} />;
  if (step.type === 'ifBlock') return <IfBlockRow passId={passId} stepId={sid} onDelete={onDelete} />;
  return <StepRow passId={passId} stepId={sid} onDelete={onDelete} onDuplicate={onDuplicate} />;
}

// ─── Drop zone for empty lists ────────────────────────────────────────────────

function EmptyDropZone({ id, label }: { id: string; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`mx-3 my-2 px-3 py-4 rounded border border-dashed text-center text-xs transition-colors
      ${isOver ? 'border-blue-500/60 bg-blue-900/10 text-blue-400' : 'border-zinc-700/40 text-zinc-600'}`}>
      {label}
    </div>
  );
}

// ─── Step list ────────────────────────────────────────────────────────────────

export interface StepListProps {
  passId: PassId;
  /** When set, show this variant's activeSteps instead of pass.steps */
  variantId?: VariantId;
}

export function StepList({ passId, variantId }: StepListProps) {
  const {
    pipeline,
    // base step actions
    addStep, deleteStep, duplicateStep, reorderSteps,
    // variant step actions
    addStepToVariant, deleteStepFromVariant, duplicateStepInVariant, reorderVariantSteps,
    // fallback actions
    addFallbackStep, deleteFallbackStep, duplicateFallbackStep, reorderFallbackSteps,
    // cross-list moves
    moveStepToFallback, moveStepFromFallback,
    moveVariantStepToFallback, moveVariantStepFromFallback,
  } = useStore();

  const [showActiveMenu,    setShowActiveMenu]    = useState(false);
  const [showFallbackMenu,  setShowFallbackMenu]  = useState(false);
  const [fallbackCollapsed, setFallbackCollapsed] = useState(false);

  const pass = pipeline.passes[passId];
  if (!pass) return null;

  // Determine which active step list to show
  const variant = variantId ? (pass.variants ?? []).find((v) => v.id === variantId) : undefined;
  const activeIds   = variant ? variant.activeSteps : pass.steps;
  const fallbackIds = pass.disabledSteps ?? [];

  // CRUD callbacks based on whether we're editing a variant
  const onAddActive = (type: StepType) => {
    if (variant) addStepToVariant(passId, variant.id, type);
    else addStep(passId, type);
  };
  const onDeleteActive = (sid: StepId) => {
    if (variant) deleteStepFromVariant(passId, variant.id, sid);
    else deleteStep(passId, sid);
  };
  const onDuplicateActive = (sid: StepId) => {
    if (variant) duplicateStepInVariant(passId, variant.id, sid);
    else duplicateStep(passId, sid);
  };
  const onReorderActive = (ids: StepId[]) => {
    if (variant) reorderVariantSteps(passId, variant.id, ids);
    else reorderSteps(passId, ids);
  };
  const onMoveActiveToFallback = (sid: StepId, insertAt?: number) => {
    if (variant) moveVariantStepToFallback(passId, variant.id, sid, insertAt);
    else moveStepToFallback(passId, sid, insertAt);
  };
  const onMoveFallbackToActive = (sid: StepId, insertAt?: number) => {
    if (variant) moveVariantStepFromFallback(passId, variant.id, sid, insertAt);
    else moveStepFromFallback(passId, sid, insertAt);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as StepId;
    const overId   = over.id as string;
    const srcCid   = active.data.current?.sortable?.containerId as string | undefined;
    if (!srcCid) return;
    const dstCid   = (over.data.current?.sortable?.containerId as string | undefined) ?? overId;

    if (srcCid === dstCid) {
      if (srcCid === CONTAINER_ACTIVE) {
        const oi = activeIds.indexOf(activeId);
        const ni = activeIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni) onReorderActive(arrayMove(activeIds, oi, ni));
      } else {
        const oi = fallbackIds.indexOf(activeId);
        const ni = fallbackIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni) reorderFallbackSteps(passId, arrayMove(fallbackIds, oi, ni));
      }
      return;
    }
    if (srcCid === CONTAINER_ACTIVE && dstCid === CONTAINER_FALLBACK) {
      const overIdx = fallbackIds.indexOf(overId as StepId);
      onMoveActiveToFallback(activeId, overIdx >= 0 ? overIdx : fallbackIds.length);
      setFallbackCollapsed(false);
    } else if (srcCid === CONTAINER_FALLBACK && dstCid === CONTAINER_ACTIVE) {
      const overIdx = activeIds.indexOf(overId as StepId);
      onMoveFallbackToActive(activeId, overIdx >= 0 ? overIdx : activeIds.length);
    }
  };

  const activeLabel = variant ? `${variant.name} Steps` : 'Active Steps';

  return (
    <div className="flex flex-col h-full">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {/* ── Active / Variant Steps ── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            {activeLabel} ({activeIds.length})
          </span>
          <div className="relative">
            <Button variant="ghost" size="sm" onClick={() => setShowActiveMenu(!showActiveMenu)}>+ Add Step</Button>
            {showActiveMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-52 overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {STEP_TYPES.map(({ type, label }) => (
                    <button key={type} className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                      onClick={() => { onAddActive(type); setShowActiveMenu(false); }}>
                      <Badge value={type} /><span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <div className="flex-1">
            {activeIds.length === 0 ? (
              <EmptyDropZone id={CONTAINER_ACTIVE} label="No steps — drop here or click Add Step" />
            ) : (
              <SortableContext id={CONTAINER_ACTIVE} items={activeIds} strategy={verticalListSortingStrategy}>
                {activeIds.map((sid) => (
                  <RenderStep key={sid} passId={passId} sid={sid} onDelete={() => onDeleteActive(sid)} onDuplicate={() => onDuplicateActive(sid)} />
                ))}
              </SortableContext>
            )}
          </div>

          {/* ── Fallback Steps ── */}
          <div className="border-t-2 border-zinc-700/50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60 bg-zinc-900/40">
              <button className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-300"
                onClick={() => setFallbackCollapsed(!fallbackCollapsed)}>
                <span className="text-[9px]">{fallbackCollapsed ? '▸' : '▾'}</span>
                Fallback Steps ({fallbackIds.length})
              </button>
              <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setShowFallbackMenu(!showFallbackMenu)}>+ Add</Button>
                {showFallbackMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-52 overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      {STEP_TYPES.map(({ type, label }) => (
                        <button key={type} className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                          onClick={() => { addFallbackStep(passId, type); setShowFallbackMenu(false); setFallbackCollapsed(false); }}>
                          <Badge value={type} /><span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {!fallbackCollapsed && (
              fallbackIds.length === 0 ? (
                <EmptyDropZone id={CONTAINER_FALLBACK} label="No fallback steps — drop here or click Add" />
              ) : (
                <SortableContext id={CONTAINER_FALLBACK} items={fallbackIds} strategy={verticalListSortingStrategy}>
                  {fallbackIds.map((sid) => (
                    <RenderStep key={sid} passId={passId} sid={sid} onDelete={() => deleteFallbackStep(passId, sid)} onDuplicate={() => duplicateFallbackStep(passId, sid)} />
                  ))}
                </SortableContext>
              )
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}
