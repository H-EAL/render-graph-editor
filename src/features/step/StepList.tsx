import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type CollisionDetection,
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
import type { PassId, StepId, StepType, VariantId, IfBlockStep, EnableIfStep, Variant } from '../../types';

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
  { type: 'ifBlock',             label: 'If / Else Block' },
  { type: 'enableIf',            label: 'Enable If' },
];

/** Types allowed inside branches (no nested flow-control blocks). */
const BRANCH_STEP_TYPES = STEP_TYPES.filter((t) => t.type !== 'ifBlock' && t.type !== 'enableIf');

/** Unique select-condition names from a step's fieldSelectors. */
function getSelectConditions(step: { fieldSelectors?: Record<string, { kind: string; condition?: string }> }): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const vs of Object.values(step.fieldSelectors ?? {})) {
    if (vs.kind === 'select' && vs.condition && !seen.has(vs.condition)) {
      seen.add(vs.condition);
      result.push(vs.condition);
    }
  }
  return result;
}

const CONTAINER_ACTIVE   = 'active';
const CONTAINER_VARIANT  = 'variant';
const CONTAINER_FALLBACK = 'fallback';
const BRANCH_PREFIX      = 'branch::';

function branchContainerId(ifBlockId: StepId, branch: 'then' | 'else'): string {
  return `${BRANCH_PREFIX}${ifBlockId}::${branch}`;
}

function parseBranchContainerId(cid: string): { ifBlockId: StepId; branch: 'then' | 'else' } | null {
  if (!cid.startsWith(BRANCH_PREFIX)) return null;
  const rest = cid.slice(BRANCH_PREFIX.length);
  const sep  = rest.lastIndexOf('::');
  if (sep === -1) return null;
  return { ifBlockId: rest.slice(0, sep), branch: rest.slice(sep + 2) as 'then' | 'else' };
}

// ─── Condition selector (bool input params + optional negation) ───────────────

function ConditionSelect({
  condition,
  accentColor,
  onChange,
}: {
  condition: string;
  accentColor: 'purple' | 'teal';
  onChange: (value: string) => void;
}) {
  const { resources } = useStore();
  const boolParams = resources.inputParameters.filter((p) => p.type === 'bool');

  const negated   = condition.startsWith('!');
  const paramName = negated ? condition.slice(1) : condition;

  const ringCls = accentColor === 'purple' ? 'focus:ring-purple-500/60' : 'focus:ring-teal-500/60';

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
      <select
        className={`flex-1 min-w-0 bg-zinc-800 border border-zinc-600/60 text-zinc-200 text-xs rounded px-2 py-0.5 font-mono focus:outline-none focus:ring-1 ${ringCls}`}
        value={paramName}
        onChange={(e) => onChange((negated ? '!' : '') + e.target.value)}
      >
        <option value="">— pick condition —</option>
        {boolParams.map((p) => (
          <option key={p.id} value={p.name}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}

// ─── IfBlock branch column ────────────────────────────────────────────────────

interface IfBranchListProps {
  passId: PassId;
  ifBlockId: StepId;
  branch: 'then' | 'else';
  /** accent color for the header */
  color: 'green' | 'orange' | 'teal';
  label?: string;
}

function IfBranchList({ passId, ifBlockId, branch, color, label }: IfBranchListProps) {
  const { pipeline, selectedStepId, selectStep, addStepToIfBranch, deleteStepFromIfBranch } = useStore();
  const [showMenu, setShowMenu] = useState(false);

  const parentStep = pipeline.steps[ifBlockId];
  if (!parentStep || (parentStep.type !== 'ifBlock' && parentStep.type !== 'enableIf')) return null;
  const stepIds = branch === 'then'
    ? (parentStep as IfBlockStep).thenSteps
    : (parentStep as IfBlockStep).elseSteps ?? [];

  const containerId = branchContainerId(ifBlockId, branch);

  const headerCls =
    color === 'green'  ? 'bg-green-950/30 text-green-400/90 border-b border-green-900/30' :
    color === 'orange' ? 'bg-orange-950/30 text-orange-400/90 border-b border-orange-900/30' :
    'bg-teal-950/30 text-teal-400/90 border-b border-teal-900/30';

  return (
    <div className="flex flex-col min-w-0">
      {/* Branch header */}
      {label && (
        <div className={`flex items-center gap-2 px-2 py-1 ${headerCls}`}>
          <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
          <span className="text-[9px] opacity-50">{stepIds.length} step{stepIds.length !== 1 ? 's' : ''}</span>
        </div>
      )}
      {/* Steps — SortableContext participates in the parent DndContext */}
      {stepIds.length === 0 ? (
        <EmptyDropZone id={containerId} label="Drop here" />
      ) : (
        <SortableContext id={containerId} items={stepIds} strategy={verticalListSortingStrategy}>
          {stepIds.map((sid) => {
            const step = pipeline.steps[sid];
            if (!step) return null;
            if (step.type === 'raster') return <RasterStepBlock key={sid} passId={passId} stepId={sid} />;
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
          })}
        </SortableContext>
      )}
      {/* Add step */}
      <div className="relative pl-5 pr-2 py-1 mt-auto border-t border-zinc-800/40">
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


function BranchStepRow({ passId: _passId, stepId, isSelected, onSelect, onDelete }: BranchStepRowProps) {
  const { pipeline } = useStore();
  const step = pipeline.steps[stepId];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  if (!step) return null;

  const selectConds = getSelectConditions(step as Parameters<typeof getSelectConditions>[0]);

  return (
    <div ref={setNodeRef} style={style} onClick={onSelect}
      className={`group flex items-center gap-1.5 pl-5 pr-3 py-1.5 cursor-pointer border-b border-zinc-800/40 hover:bg-zinc-800/30 select-none
        ${isSelected ? 'bg-blue-900/20 border-l-2 border-l-blue-400' : 'border-l-2 border-l-transparent'}`}>
      <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
      <Badge value={step.type} />
      <span className="flex-1 text-xs text-zinc-300 truncate">{step.name}</span>
      {selectConds.map((c) => (
        <span key={c} className="text-[9px] font-mono bg-violet-900/30 text-violet-300 border border-violet-700/40 rounded px-1 py-0.5 shrink-0 max-w-16 truncate" title={c}>{c}</span>
      ))}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button onClick={onDelete} title="Delete" className="p-0.5 text-zinc-500 hover:text-red-400 rounded text-xs">✕</button>
      </div>
    </div>
  );
}

// ─── IfBlock row (if / else — two columns side by side) ───────────────────────

interface IfBlockRowProps {
  passId: PassId;
  stepId: StepId;
  onDelete: () => void;
}

function IfBlockRow({ passId, stepId, onDelete }: IfBlockRowProps) {
  const { pipeline, selectedStepId, selectStep, duplicateStep, updateIfBlockCondition, convertStepBlockType } = useStore();
  const step = pipeline.steps[stepId] as IfBlockStep | undefined;
  const isSelected = selectedStepId === stepId;
  const [expanded, setExpanded] = useState(true);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step || step.type !== 'ifBlock') return null;

  const canConvertToEnableIf = step.thenSteps.length === 0 || (step.elseSteps ?? []).length === 0;

  return (
    <div style={style}
      className={`group border-b border-zinc-800/50 border-l-2 ${isSelected ? 'border-l-purple-500' : 'border-l-transparent'}`}>
      {/* Header — setNodeRef here so the droppable rect is header-only, not the full block.
          This lets items dragged from outside naturally target branch items below. */}
      <div ref={setNodeRef} className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-zinc-800/40 ${isSelected ? 'bg-purple-900/20' : ''}`}
        onClick={() => selectStep(isSelected ? null : stepId)}>
        <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
        <button className="text-zinc-500 hover:text-zinc-300 shrink-0 text-xs w-3"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider shrink-0">if</span>
        <ConditionSelect
          condition={step.condition}
          accentColor="purple"
          onChange={(v) => updateIfBlockCondition(stepId, v)}
        />
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {canConvertToEnableIf && (
            <button onClick={() => convertStepBlockType(stepId)} title="Convert to enable if" className="p-1 text-zinc-500 hover:text-teal-400 rounded text-[10px] font-mono">enable if</button>
          )}
          <button onClick={() => duplicateStep(passId, stepId)} title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200 rounded">⧉</button>
          <button onClick={onDelete} title="Delete" className="p-1 text-zinc-500 hover:text-red-400 rounded">✕</button>
        </div>
      </div>

      {/* Branches — side by side */}
      {expanded && (
        <div className="flex border-t border-purple-900/20">
          {/* THEN */}
          <div className="flex-1 min-w-0 border-r border-zinc-700/40">
            <IfBranchList passId={passId} ifBlockId={stepId} branch="then" color="green" label="then" />
          </div>
          {/* ELSE */}
          <div className="flex-1 min-w-0">
            <IfBranchList passId={passId} ifBlockId={stepId} branch="else" color="orange" label="else" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EnableIf row (guard — single branch, no else) ────────────────────────────

interface EnableIfRowProps {
  passId: PassId;
  stepId: StepId;
  onDelete: () => void;
}

function EnableIfRow({ passId, stepId, onDelete }: EnableIfRowProps) {
  const { pipeline, selectedStepId, selectStep, duplicateStep, updateIfBlockCondition, convertStepBlockType } = useStore();
  const step = pipeline.steps[stepId] as EnableIfStep | undefined;
  const isSelected = selectedStepId === stepId;
  const [expanded, setExpanded] = useState(true);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step || step.type !== 'enableIf') return null;

  return (
    <div style={style}
      className={`group border-b border-zinc-800/50 border-l-2 ${isSelected ? 'border-l-teal-500' : 'border-l-transparent'}`}>
      {/* Header — setNodeRef here so the droppable rect is header-only, not the full block. */}
      <div ref={setNodeRef} className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-zinc-800/40 ${isSelected ? 'bg-teal-900/20' : ''}`}
        onClick={() => selectStep(isSelected ? null : stepId)}>
        <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
        <button className="text-zinc-500 hover:text-zinc-300 shrink-0 text-xs w-3"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-[10px] font-bold text-teal-400 uppercase tracking-wider shrink-0">enable if</span>
        <ConditionSelect
          condition={step.condition}
          accentColor="teal"
          onChange={(v) => updateIfBlockCondition(stepId, v)}
        />
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => convertStepBlockType(stepId)} title="Convert to if/else" className="p-1 text-zinc-500 hover:text-purple-400 rounded text-[10px] font-mono">if/else</button>
          <button onClick={() => duplicateStep(passId, stepId)} title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200 rounded">⧉</button>
          <button onClick={onDelete} title="Delete" className="p-1 text-zinc-500 hover:text-red-400 rounded">✕</button>
        </div>
      </div>

      {/* Single branch */}
      {expanded && (
        <div className="border-t border-teal-900/20 border-l-4 border-l-teal-700/50">
          <IfBranchList passId={passId} ifBlockId={stepId} branch="then" color="teal" />
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

function StepRow({ passId: _passId, stepId, onDelete, onDuplicate }: StepRowProps) {
  const { pipeline, selectedStepId, selectStep } = useStore();
  const step = pipeline.steps[stepId];
  const isSelected = selectedStepId === stepId;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  if (!step) return null;

  const selectConds = getSelectConditions(step as Parameters<typeof getSelectConditions>[0]);

  return (
    <div ref={setNodeRef} style={style} onClick={() => selectStep(isSelected ? null : stepId)}
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/40 select-none
        ${isSelected ? 'bg-blue-900/25 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'}`}>
      <button {...attributes} {...listeners} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>⠿</button>
      <Badge value={step.type} />
      <span className="flex-1 text-sm text-zinc-200 truncate">{step.name}</span>
      {selectConds.map((c) => (
        <span key={c} className="text-[9px] font-mono bg-violet-900/30 text-violet-300 border border-violet-700/40 rounded px-1 py-0.5 shrink-0 max-w-16 truncate" title={c}>{c}</span>
      ))}
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
  if (step.type === 'enableIf') return <EnableIfRow passId={passId} stepId={sid} onDelete={onDelete} />;
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

// ─── Collision detection ──────────────────────────────────────────────────────

/**
 * When dragging a step that lives inside a branch (ifBlock / enableIf), prefer
 * drop targets within the SAME branch using rect-intersection (requires actual
 * overlap).  This prevents the outer IfBlockRow / EnableIfRow sortable — which
 * spans the entire height of its content — from winning the closestCenter race
 * and causing an accidental "move out of branch" drop.
 *
 * If no branch items intersect (user has dragged outside the branch area), fall
 * back to global closestCenter so cross-container drops still work.
 */
const branchAwareCollision: CollisionDetection = (args) => {
  const activeContainerId = args.active.data.current?.sortable?.containerId as string | undefined;

  // When dragging FROM inside a branch, prefer items in the SAME branch via rect
  // intersection. Without this, the outer IfBlockRow/EnableIfRow sortable (whose
  // droppable rect covers its header only — see setNodeRef placement) would still
  // win closestCenter for same-branch reorders when the header happens to be closer.
  if (activeContainerId?.startsWith(BRANCH_PREFIX)) {
    const sameBranch = args.droppableContainers.filter((c) => {
      const cid = (c.data.current?.sortable?.containerId ?? c.id) as string;
      return cid === activeContainerId || c.id === activeContainerId;
    });
    if (sameBranch.length > 0) {
      const inner = rectIntersection({ ...args, droppableContainers: sameBranch });
      if (inner.length > 0) return inner;
    }
  }

  return closestCenter(args);
};

// ─── Step list ────────────────────────────────────────────────────────────────

export interface StepListProps {
  passId: PassId;
  /** When provided, a variant tabs + steps section is rendered between common and fallback. */
  variants?: Variant[];
  /** Currently selected variant tab (controlled by parent). */
  activeVariantId?: VariantId | null;
  /** Called when user clicks a variant tab. */
  onVariantChange?: (id: VariantId) => void;
}

export function StepList({ passId, variants, activeVariantId, onVariantChange }: StepListProps) {
  const {
    pipeline,
    // common step actions
    addStep, deleteStep, duplicateStep, reorderSteps,
    // fallback actions
    addFallbackStep, deleteFallbackStep, duplicateFallbackStep, reorderFallbackSteps,
    // common ↔ fallback
    moveStepToFallback, moveStepFromFallback,
    // variant step actions
    addStepToVariant, deleteStepFromVariant, duplicateStepInVariant, reorderVariantSteps,
    // common ↔ variant
    moveStepToVariant, moveStepFromVariant,
    // variant ↔ fallback
    moveVariantStepToFallback, moveVariantStepFromFallback,
    // branch cross-container moves
    reorderIfBranch, moveStepToBranch, moveStepFromBranch, moveStepBetweenBranches,
  } = useStore();

  const [showCommonMenu,   setShowCommonMenu]   = useState(false);
  const [showVariantMenu,  setShowVariantMenu]  = useState(false);
  const [showFallbackMenu, setShowFallbackMenu] = useState(false);
  const [fallbackCollapsed, setFallbackCollapsed] = useState(false);

  const pass = pipeline.passes[passId];
  if (!pass) return null;

  const hasVariants = !!variants && variants.length > 0;
  const activeVariant = hasVariants ? (variants!.find((v) => v.id === activeVariantId) ?? null) : null;

  const commonIds   = pass.steps;
  const variantIds  = activeVariant?.activeSteps ?? [];
  const fallbackIds = pass.disabledSteps ?? [];

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

    const srcBranch = parseBranchContainerId(srcCid);
    const dstBranch = parseBranchContainerId(dstCid);

    // ── Same container ──────────────────────────────────────────────────────
    if (srcCid === dstCid) {
      if (srcCid === CONTAINER_ACTIVE) {
        const oi = commonIds.indexOf(activeId);
        const ni = commonIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni) reorderSteps(passId, arrayMove(commonIds, oi, ni));
      } else if (srcCid === CONTAINER_VARIANT && activeVariant) {
        const oi = variantIds.indexOf(activeId);
        const ni = variantIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni) reorderVariantSteps(passId, activeVariant.id, arrayMove(variantIds, oi, ni));
      } else if (srcCid === CONTAINER_FALLBACK) {
        const oi = fallbackIds.indexOf(activeId);
        const ni = fallbackIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni) reorderFallbackSteps(passId, arrayMove(fallbackIds, oi, ni));
      } else if (srcBranch) {
        const ifStep = pipeline.steps[srcBranch.ifBlockId];
        if (!ifStep) return;
        const branchIds = srcBranch.branch === 'then'
          ? (ifStep as IfBlockStep).thenSteps
          : (ifStep as IfBlockStep).elseSteps ?? [];
        const oi = branchIds.indexOf(activeId);
        const ni = branchIds.indexOf(overId as StepId);
        if (oi !== -1 && ni !== -1 && oi !== ni)
          reorderIfBranch(srcBranch.ifBlockId, srcBranch.branch, arrayMove(branchIds, oi, ni));
      }
      return;
    }

    // ── Cross-container ─────────────────────────────────────────────────────

    // Common ↔ Fallback
    if (srcCid === CONTAINER_ACTIVE && dstCid === CONTAINER_FALLBACK) {
      const overIdx = fallbackIds.indexOf(overId as StepId);
      moveStepToFallback(passId, activeId, overIdx >= 0 ? overIdx : fallbackIds.length);
      setFallbackCollapsed(false);
      return;
    }
    if (srcCid === CONTAINER_FALLBACK && dstCid === CONTAINER_ACTIVE) {
      const overIdx = commonIds.indexOf(overId as StepId);
      moveStepFromFallback(passId, activeId, overIdx >= 0 ? overIdx : commonIds.length);
      return;
    }

    // Common ↔ Variant
    if (srcCid === CONTAINER_ACTIVE && dstCid === CONTAINER_VARIANT && activeVariant) {
      const overIdx = variantIds.indexOf(overId as StepId);
      moveStepToVariant(passId, activeVariant.id, activeId, overIdx >= 0 ? overIdx : variantIds.length);
      return;
    }
    if (srcCid === CONTAINER_VARIANT && dstCid === CONTAINER_ACTIVE && activeVariant) {
      const overIdx = commonIds.indexOf(overId as StepId);
      moveStepFromVariant(passId, activeVariant.id, activeId, overIdx >= 0 ? overIdx : commonIds.length);
      return;
    }

    // Variant ↔ Fallback
    if (srcCid === CONTAINER_VARIANT && dstCid === CONTAINER_FALLBACK && activeVariant) {
      const overIdx = fallbackIds.indexOf(overId as StepId);
      moveVariantStepToFallback(passId, activeVariant.id, activeId, overIdx >= 0 ? overIdx : fallbackIds.length);
      setFallbackCollapsed(false);
      return;
    }
    if (srcCid === CONTAINER_FALLBACK && dstCid === CONTAINER_VARIANT && activeVariant) {
      const overIdx = variantIds.indexOf(overId as StepId);
      moveVariantStepFromFallback(passId, activeVariant.id, activeId, overIdx >= 0 ? overIdx : variantIds.length);
      return;
    }

    // Common → Branch
    if (srcCid === CONTAINER_ACTIVE && dstBranch) {
      const ifStep = pipeline.steps[dstBranch.ifBlockId];
      if (!ifStep) return;
      const dstIds = dstBranch.branch === 'then'
        ? (ifStep as IfBlockStep).thenSteps
        : (ifStep as IfBlockStep).elseSteps ?? [];
      const overIdx = dstIds.indexOf(overId as StepId);
      moveStepToBranch(passId, dstBranch.ifBlockId, dstBranch.branch, activeId, overIdx >= 0 ? overIdx : dstIds.length);
      return;
    }

    // Branch → Common
    if (srcBranch && dstCid === CONTAINER_ACTIVE) {
      const overIdx = commonIds.indexOf(overId as StepId);
      moveStepFromBranch(passId, srcBranch.ifBlockId, srcBranch.branch, activeId, overIdx >= 0 ? overIdx : commonIds.length);
      return;
    }

    // Branch → Branch
    if (srcBranch && dstBranch) {
      const ifStep = pipeline.steps[dstBranch.ifBlockId];
      if (!ifStep) return;
      const dstIds = dstBranch.branch === 'then'
        ? (ifStep as IfBlockStep).thenSteps
        : (ifStep as IfBlockStep).elseSteps ?? [];
      const overIdx = dstIds.indexOf(overId as StepId);
      moveStepBetweenBranches(
        srcBranch.ifBlockId, srcBranch.branch,
        dstBranch.ifBlockId, dstBranch.branch,
        activeId,
        overIdx >= 0 ? overIdx : dstIds.length,
      );
    }
  };

  return (
    <div className="flex flex-col">
      <DndContext sensors={sensors} collisionDetection={branchAwareCollision} onDragEnd={onDragEnd}>

        {/* ── Common / Active Steps ── */}
        <div className="border-l-2 border-blue-600/40">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60 bg-blue-950/20">
            <span className="text-xs font-semibold text-blue-300/80 uppercase tracking-wider">
              {hasVariants ? 'Common Steps' : 'Active Steps'} ({commonIds.length})
            </span>
            <div className="relative">
              <Button variant="ghost" size="sm" onClick={() => setShowCommonMenu(!showCommonMenu)}>+ Add Step</Button>
              {showCommonMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-52 overflow-hidden">
                  <div className="max-h-72 overflow-y-auto">
                    {STEP_TYPES.map(({ type, label }) => (
                      <button key={type} className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                        onClick={() => { addStep(passId, type); setShowCommonMenu(false); }}>
                        <Badge value={type} /><span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {commonIds.length === 0 ? (
            <EmptyDropZone id={CONTAINER_ACTIVE} label="No steps — drop here or click Add Step" />
          ) : (
            <SortableContext id={CONTAINER_ACTIVE} items={commonIds} strategy={verticalListSortingStrategy}>
              {commonIds.map((sid) => (
                <RenderStep key={sid} passId={passId} sid={sid} onDelete={() => deleteStep(passId, sid)} onDuplicate={() => duplicateStep(passId, sid)} />
              ))}
            </SortableContext>
          )}
        </div>

        {/* ── Variant Steps ── */}
        {variants && variants.length > 0 && (
          <div className="mt-2 border-l-2 border-violet-600/50">
            {/* Tabs row */}
            <div className="px-3 py-2 bg-violet-950/30 border-b border-violet-800/50">
              <div className="text-[9px] font-bold text-violet-400/50 uppercase tracking-widest mb-2">Variant</div>
              <div className="flex flex-wrap gap-3">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onVariantChange?.(v.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      activeVariantId === v.id
                        ? 'bg-violet-600 text-white shadow'
                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
            {activeVariant ? (
              <>
                <div className="flex items-center justify-between px-3 py-2 border-b border-violet-900/40 bg-violet-950/20">
                  <span className="text-xs font-semibold text-violet-300/80 uppercase tracking-wider">
                    {activeVariant.name} Steps ({variantIds.length})
                  </span>
                  <div className="relative">
                    <Button variant="ghost" size="sm" onClick={() => setShowVariantMenu(!showVariantMenu)}>+ Add Step</Button>
                    {showVariantMenu && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-52 overflow-hidden">
                        <div className="max-h-72 overflow-y-auto">
                          {STEP_TYPES.map(({ type, label }) => (
                            <button key={type} className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
                              onClick={() => { addStepToVariant(passId, activeVariant.id, type); setShowVariantMenu(false); }}>
                              <Badge value={type} /><span>{label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {variantIds.length === 0 ? (
                  <EmptyDropZone id={CONTAINER_VARIANT} label="No variant steps — drop here or click Add Step" />
                ) : (
                  <SortableContext id={CONTAINER_VARIANT} items={variantIds} strategy={verticalListSortingStrategy}>
                    {variantIds.map((sid) => (
                      <RenderStep key={sid} passId={passId} sid={sid}
                        onDelete={() => deleteStepFromVariant(passId, activeVariant.id, sid)}
                        onDuplicate={() => duplicateStepInVariant(passId, activeVariant.id, sid)} />
                    ))}
                  </SortableContext>
                )}
              </>
            ) : (
              <div className="px-3 py-3 text-[10px] text-zinc-600 italic">Select a variant tab to view its steps.</div>
            )}
          </div>
        )}

        {/* ── Fallback Steps ── */}
        <div className="mt-2 border-l-2 border-zinc-500/30">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/60 bg-zinc-800/40">
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

      </DndContext>
    </div>
  );
}
