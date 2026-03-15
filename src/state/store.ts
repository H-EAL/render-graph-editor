import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { newId } from '../utils/id';
import { seedDocument } from '../data/seed';
import type {
  Pipeline,
  Pass,
  PassId,
  Step,
  StepId,
  StepType,
  Timeline,
  TimelineId,
  TimelineType,
  ResourceLibrary,
  RenderTarget,
  Buffer,
  BlendState,
  Shader,
  InputParameter,
  ResourceId,
} from '../types';

// ─── Default factories ────────────────────────────────────────────────────────

export function makeDefaultStep(type: StepType): Step {
  const base = { id: newId(), name: `New ${type}`, reads: [], writes: [], conditions: [] };
  switch (type) {
    case 'drawBatch':
      return { ...base, type, shader: '', blendState: '', depthTest: true, depthWrite: true, cullMode: 'back' };
    case 'drawBatchWithMaterials':
      return { ...base, type, shader: '', blendState: '', depthTest: true, depthWrite: true, cullMode: 'back' };
    case 'dispatchCompute':
      return { ...base, type, shader: '', groupsX: 1, groupsY: 1, groupsZ: 1 };
    case 'dispatchRayTracing':
      return { ...base, type, raygenShader: '', width: 'viewport.width', height: 'viewport.height' };
    case 'drawFullscreen':
      return { ...base, type, shader: '' };
    case 'copyImage':
      return { ...base, type, source: '', destination: '' };
    case 'blitImage':
      return { ...base, type, source: '', destination: '', filter: 'linear' };
    case 'resolveImage':
      return { ...base, type, source: '', destination: '' };
    case 'clearImages':
      return { ...base, type, targets: [] };
    case 'fillBuffer':
      return { ...base, type, target: '', value: 0 };
    case 'generateMipChain':
      return { ...base, type, target: '', filter: 'linear' };
    case 'viewport':
      return { ...base, type, x: 0, y: 0, width: 'viewport.width', height: 'viewport.height', minDepth: 0, maxDepth: 1 };
    case 'drawDebugLines':
      return { ...base, type, lineWidth: 1 };
  }
}

function makeDefaultPass(timelineId: TimelineId): Pass {
  return {
    id: newId(),
    name: 'New Pass',
    kind: 'raster',
    timelineId,
    enabled: true,
    conditions: [],
    reads: [],
    writes: [],
    manualDeps: [],
    steps: [],
    rasterAttachments: { colorAttachments: [], depthAttachment: undefined },
  };
}

function makeDefaultTimeline(type: TimelineType = 'graphics'): Timeline {
  return {
    id: newId(),
    name: type === 'asyncCompute' ? 'Async Compute' : type.charAt(0).toUpperCase() + type.slice(1),
    type,
    passIds: [],
  };
}

function resourceOrderFromLibrary(resources: ResourceLibrary): ResourceId[] {
  return [
    ...resources.renderTargets.map((r) => r.id),
    ...resources.buffers.map((b) => b.id),
  ];
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface AppState {
  // Data
  pipeline: Pipeline;
  resources: ResourceLibrary;

  // Selection
  selectedPassId: PassId | null;
  selectedStepId: StepId | null;
  selectedResourceId: ResourceId | null;
  /** Display order of RT + Buffer resources in the timeline overlay rows */
  resourceOrder: ResourceId[];

  // ── Timeline actions ──────────────────────────────────────────────────────
  addTimeline: (type?: TimelineType) => void;
  deleteTimeline: (id: TimelineId) => void;
  updateTimeline: (id: TimelineId, patch: Partial<Pick<Timeline, 'name' | 'type'>>) => void;
  reorderTimelines: (orderedIds: TimelineId[]) => void;

  // ── Pass actions ──────────────────────────────────────────────────────────
  setPipelineName: (name: string) => void;
  addPass: (timelineId: TimelineId, insertAt?: number) => void;
  deletePass: (id: PassId) => void;
  duplicatePass: (id: PassId) => void;
  reorderPassesInTimeline: (timelineId: TimelineId, orderedIds: PassId[]) => void;
  movePassToTimeline: (passId: PassId, toTimelineId: TimelineId) => void;
  updatePass: (id: PassId, patch: Partial<Omit<Pass, 'id' | 'steps'>>) => void;

  // ── Step actions ──────────────────────────────────────────────────────────
  addStep: (passId: PassId, type: StepType) => void;
  deleteStep: (passId: PassId, stepId: StepId) => void;
  duplicateStep: (passId: PassId, stepId: StepId) => void;
  reorderSteps: (passId: PassId, orderedIds: StepId[]) => void;
  updateStep: (stepId: StepId, patch: Partial<Step>) => void;

  // ── Selection ─────────────────────────────────────────────────────────────
  selectPass: (id: PassId | null) => void;
  selectStep: (id: StepId | null) => void;
  selectResource: (id: ResourceId | null) => void;
  setResourceOrder: (ids: ResourceId[]) => void;
  addManualDep: (passId: PassId, depPassId: PassId) => void;
  removeManualDep: (passId: PassId, depPassId: PassId) => void;

  // ── Resource actions ──────────────────────────────────────────────────────
  addRenderTarget: (rt: RenderTarget) => void;
  updateRenderTarget: (id: ResourceId, patch: Partial<RenderTarget>) => void;
  deleteRenderTarget: (id: ResourceId) => void;

  addBuffer: (b: Buffer) => void;
  updateBuffer: (id: ResourceId, patch: Partial<Buffer>) => void;
  deleteBuffer: (id: ResourceId) => void;

  addBlendState: (bs: BlendState) => void;
  updateBlendState: (id: ResourceId, patch: Partial<BlendState>) => void;
  deleteBlendState: (id: ResourceId) => void;

  addShader: (s: Shader) => void;
  updateShader: (id: ResourceId, patch: Partial<Shader>) => void;
  deleteShader: (id: ResourceId) => void;

  addInputParameter: (p: InputParameter) => void;
  updateInputParameter: (id: ResourceId, patch: Partial<InputParameter>) => void;
  deleteInputParameter: (id: ResourceId) => void;

  // ── IO ────────────────────────────────────────────────────────────────────
  loadDocument: (json: string) => void;
  getDocumentJson: () => string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function firstPassId(pipeline: Pipeline): PassId | null {
  for (const tl of pipeline.timelines) {
    if (tl.passIds.length > 0) return tl.passIds[0];
  }
  return null;
}

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    pipeline: seedDocument.pipeline,
    resources: seedDocument.resources,
    selectedPassId: firstPassId(seedDocument.pipeline),
    selectedStepId: null,
    selectedResourceId: null,
    resourceOrder: resourceOrderFromLibrary(seedDocument.resources),

    // ── Timelines ─────────────────────────────────────────────────────────
    addTimeline: (type = 'graphics') =>
      set((s) => ({
        pipeline: {
          ...s.pipeline,
          timelines: [...s.pipeline.timelines, makeDefaultTimeline(type)],
        },
      })),

    deleteTimeline: (id) =>
      set((s) => {
        const timeline = s.pipeline.timelines.find((tl) => tl.id === id);
        if (!timeline) return {};
        const passes = { ...s.pipeline.passes };
        const steps = { ...s.pipeline.steps };
        for (const pid of timeline.passIds) {
          const pass = passes[pid];
          if (pass) pass.steps.forEach((sid) => delete steps[sid]);
          delete passes[pid];
        }
        const timelines = s.pipeline.timelines.filter((tl) => tl.id !== id);
        const selectedPassId = timeline.passIds.includes(s.selectedPassId ?? '') ? firstPassId({ ...s.pipeline, timelines, passes }) : s.selectedPassId;
        return {
          pipeline: { ...s.pipeline, timelines, passes, steps },
          selectedPassId,
          selectedStepId: timeline.passIds.includes(s.selectedPassId ?? '') ? null : s.selectedStepId,
        };
      }),

    updateTimeline: (id, patch) =>
      set((s) => ({
        pipeline: {
          ...s.pipeline,
          timelines: s.pipeline.timelines.map((tl) => (tl.id === id ? { ...tl, ...patch } : tl)),
        },
      })),

    reorderTimelines: (orderedIds) =>
      set((s) => {
        const map = new Map(s.pipeline.timelines.map((tl) => [tl.id, tl]));
        return {
          pipeline: {
            ...s.pipeline,
            timelines: orderedIds.map((id) => map.get(id)!).filter(Boolean),
          },
        };
      }),

    // ── Pipeline / Pass ───────────────────────────────────────────────────
    setPipelineName: (name) => set((s) => ({ pipeline: { ...s.pipeline, name } })),

    addPass: (timelineId, insertAt) =>
      set((s) => {
        const pass = makeDefaultPass(timelineId);
        const passes = { ...s.pipeline.passes, [pass.id]: pass };
        const timelines = s.pipeline.timelines.map((tl) => {
          if (tl.id !== timelineId) return tl;
          const ids = [...tl.passIds];
          if (insertAt !== undefined) ids.splice(insertAt, 0, pass.id);
          else ids.push(pass.id);
          return { ...tl, passIds: ids };
        });
        return { pipeline: { ...s.pipeline, timelines, passes }, selectedPassId: pass.id, selectedStepId: null };
      }),

    deletePass: (id) =>
      set((s) => {
        const pass = s.pipeline.passes[id];
        if (!pass) return {};
        const passes = { ...s.pipeline.passes };
        delete passes[id];
        const steps = { ...s.pipeline.steps };
        pass.steps.forEach((sid) => delete steps[sid]);
        const timelines = s.pipeline.timelines.map((tl) => ({
          ...tl,
          passIds: tl.passIds.filter((pid) => pid !== id),
        }));
        const selectedPassId = s.selectedPassId === id ? firstPassId({ ...s.pipeline, timelines, passes }) : s.selectedPassId;
        return {
          pipeline: { ...s.pipeline, timelines, passes, steps },
          selectedPassId,
          selectedStepId: s.selectedPassId === id ? null : s.selectedStepId,
        };
      }),

    duplicatePass: (id) =>
      set((s) => {
        const src = s.pipeline.passes[id];
        if (!src) return {};
        const newStepIds: StepId[] = [];
        const newSteps = { ...s.pipeline.steps };
        src.steps.forEach((sid) => {
          const srcStep = s.pipeline.steps[sid];
          if (!srcStep) return;
          const newStep = { ...srcStep, id: newId() };
          newSteps[newStep.id] = newStep;
          newStepIds.push(newStep.id);
        });
        const newPass: Pass = { ...src, id: newId(), name: src.name + ' (copy)', steps: newStepIds };
        const passes = { ...s.pipeline.passes, [newPass.id]: newPass };
        const timelines = s.pipeline.timelines.map((tl) => {
          if (tl.id !== src.timelineId) return tl;
          const idx = tl.passIds.indexOf(id);
          const newPassIds = [...tl.passIds];
          newPassIds.splice(idx + 1, 0, newPass.id);
          return { ...tl, passIds: newPassIds };
        });
        return { pipeline: { ...s.pipeline, timelines, passes, steps: newSteps }, selectedPassId: newPass.id, selectedStepId: null };
      }),

    reorderPassesInTimeline: (timelineId, orderedIds) =>
      set((s) => ({
        pipeline: {
          ...s.pipeline,
          timelines: s.pipeline.timelines.map((tl) =>
            tl.id === timelineId ? { ...tl, passIds: orderedIds } : tl
          ),
        },
      })),

    movePassToTimeline: (passId, toTimelineId) =>
      set((s) => {
        const pass = s.pipeline.passes[passId];
        if (!pass || pass.timelineId === toTimelineId) return {};
        const fromTimelineId = pass.timelineId;
        const timelines = s.pipeline.timelines.map((tl) => {
          if (tl.id === fromTimelineId) return { ...tl, passIds: tl.passIds.filter((pid) => pid !== passId) };
          if (tl.id === toTimelineId) return { ...tl, passIds: [...tl.passIds, passId] };
          return tl;
        });
        const passes = { ...s.pipeline.passes, [passId]: { ...pass, timelineId: toTimelineId } };
        return { pipeline: { ...s.pipeline, timelines, passes } };
      }),

    updatePass: (id, patch) =>
      set((s) => ({
        pipeline: {
          ...s.pipeline,
          passes: { ...s.pipeline.passes, [id]: { ...s.pipeline.passes[id], ...patch } },
        },
      })),

    // ── Steps ─────────────────────────────────────────────────────────────
    addStep: (passId, type) =>
      set((s) => {
        const step = makeDefaultStep(type);
        const pass = s.pipeline.passes[passId];
        if (!pass) return {};
        const passes = { ...s.pipeline.passes, [passId]: { ...pass, steps: [...pass.steps, step.id] } };
        const steps = { ...s.pipeline.steps, [step.id]: step };
        return { pipeline: { ...s.pipeline, passes, steps }, selectedStepId: step.id };
      }),

    deleteStep: (passId, stepId) =>
      set((s) => {
        const pass = s.pipeline.passes[passId];
        if (!pass) return {};
        const passes = { ...s.pipeline.passes, [passId]: { ...pass, steps: pass.steps.filter((sid) => sid !== stepId) } };
        const steps = { ...s.pipeline.steps };
        delete steps[stepId];
        return {
          pipeline: { ...s.pipeline, passes, steps },
          selectedStepId: s.selectedStepId === stepId ? null : s.selectedStepId,
        };
      }),

    duplicateStep: (passId, stepId) =>
      set((s) => {
        const src = s.pipeline.steps[stepId];
        const pass = s.pipeline.passes[passId];
        if (!src || !pass) return {};
        const newStep = { ...src, id: newId(), name: src.name + ' (copy)' };
        const idx = pass.steps.indexOf(stepId);
        const newStepIds = [...pass.steps];
        newStepIds.splice(idx + 1, 0, newStep.id);
        const passes = { ...s.pipeline.passes, [passId]: { ...pass, steps: newStepIds } };
        const steps = { ...s.pipeline.steps, [newStep.id]: newStep };
        return { pipeline: { ...s.pipeline, passes, steps }, selectedStepId: newStep.id };
      }),

    reorderSteps: (passId, orderedIds) =>
      set((s) => {
        const pass = s.pipeline.passes[passId];
        if (!pass) return {};
        return {
          pipeline: {
            ...s.pipeline,
            passes: { ...s.pipeline.passes, [passId]: { ...pass, steps: orderedIds } },
          },
        };
      }),

    updateStep: (stepId, patch) =>
      set((s) => ({
        pipeline: {
          ...s.pipeline,
          steps: { ...s.pipeline.steps, [stepId]: { ...s.pipeline.steps[stepId], ...patch } as Step },
        },
      })),

    // ── Selection ─────────────────────────────────────────────────────────
    selectPass: (id) => set({ selectedPassId: id, selectedStepId: null }),
    selectStep: (id) => set({ selectedStepId: id }),
    selectResource: (id) => set({ selectedResourceId: id }),
    setResourceOrder: (ids) => set({ resourceOrder: ids }),

    addManualDep: (passId, depPassId) =>
      set((s) => {
        const pass = s.pipeline.passes[passId];
        if (!pass) return {};
        const existing = pass.manualDeps ?? [];
        if (existing.includes(depPassId)) return {};
        return {
          pipeline: {
            ...s.pipeline,
            passes: {
              ...s.pipeline.passes,
              [passId]: { ...pass, manualDeps: [...existing, depPassId] },
            },
          },
        };
      }),

    removeManualDep: (passId, depPassId) =>
      set((s) => {
        const pass = s.pipeline.passes[passId];
        if (!pass) return {};
        return {
          pipeline: {
            ...s.pipeline,
            passes: {
              ...s.pipeline.passes,
              [passId]: { ...pass, manualDeps: (pass.manualDeps ?? []).filter((id) => id !== depPassId) },
            },
          },
        };
      }),

    // ── Resources ─────────────────────────────────────────────────────────
    addRenderTarget: (rt) =>
      set((s) => ({
        resources: { ...s.resources, renderTargets: [...s.resources.renderTargets, rt] },
        resourceOrder: [...s.resourceOrder, rt.id],
      })),
    updateRenderTarget: (id, patch) =>
      set((s) => ({ resources: { ...s.resources, renderTargets: s.resources.renderTargets.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
    deleteRenderTarget: (id) =>
      set((s) => ({
        resources: { ...s.resources, renderTargets: s.resources.renderTargets.filter((r) => r.id !== id) },
        resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
        selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
      })),

    addBuffer: (b) =>
      set((s) => ({
        resources: { ...s.resources, buffers: [...s.resources.buffers, b] },
        resourceOrder: [...s.resourceOrder, b.id],
      })),
    updateBuffer: (id, patch) =>
      set((s) => ({ resources: { ...s.resources, buffers: s.resources.buffers.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
    deleteBuffer: (id) =>
      set((s) => ({
        resources: { ...s.resources, buffers: s.resources.buffers.filter((r) => r.id !== id) },
        resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
        selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
      })),

    addBlendState: (bs) =>
      set((s) => ({ resources: { ...s.resources, blendStates: [...s.resources.blendStates, bs] } })),
    updateBlendState: (id, patch) =>
      set((s) => ({ resources: { ...s.resources, blendStates: s.resources.blendStates.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
    deleteBlendState: (id) =>
      set((s) => ({
        resources: { ...s.resources, blendStates: s.resources.blendStates.filter((r) => r.id !== id) },
        selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
      })),

    addShader: (sh) =>
      set((s) => ({ resources: { ...s.resources, shaders: [...s.resources.shaders, sh] } })),
    updateShader: (id, patch) =>
      set((s) => ({ resources: { ...s.resources, shaders: s.resources.shaders.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
    deleteShader: (id) =>
      set((s) => ({
        resources: { ...s.resources, shaders: s.resources.shaders.filter((r) => r.id !== id) },
        selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
      })),

    addInputParameter: (p) =>
      set((s) => ({ resources: { ...s.resources, inputParameters: [...s.resources.inputParameters, p] } })),
    updateInputParameter: (id, patch) =>
      set((s) => ({ resources: { ...s.resources, inputParameters: s.resources.inputParameters.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
    deleteInputParameter: (id) =>
      set((s) => ({
        resources: { ...s.resources, inputParameters: s.resources.inputParameters.filter((r) => r.id !== id) },
        selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
      })),

    // ── IO ────────────────────────────────────────────────────────────────
    loadDocument: (json) => {
      try {
        const doc = JSON.parse(json);
        set({
          pipeline: doc.pipeline,
          resources: doc.resources,
          selectedPassId: firstPassId(doc.pipeline),
          selectedStepId: null,
          selectedResourceId: null,
          resourceOrder: resourceOrderFromLibrary(doc.resources),
        });
      } catch (e) {
        alert('Failed to parse JSON: ' + (e as Error).message);
      }
    },

    getDocumentJson: () => {
      const { pipeline, resources } = get();
      return JSON.stringify({ pipeline, resources }, null, 2);
    },

  }))
);
