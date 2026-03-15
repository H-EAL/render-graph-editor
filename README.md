# Render Pipeline Editor

A production-quality hierarchical render pipeline authoring tool. Replaces node-graph editors with a structured ordered-list UI designed for large real-time rendering pipelines with async compute support.

## Running

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build
npm run preview  # preview production build
```

## Authoring model

```
Pipeline
  → Timeline     (Graphics, Async Compute, Transfer, Ray Tracing, …)
    → Pass        (ordered list of rendering phases within a timeline)
      → Step      (concrete command inside a pass)
```

**Key principle:** passes are ordered explicitly within their own timeline. Dependencies between passes — including cross-timeline sync requirements — are derived automatically from resource read/write declarations. Users never author graph edges manually.

## Architecture

### Tech stack

| Concern        | Library                            |
|----------------|------------------------------------|
| Framework      | React 19 + TypeScript              |
| Build          | Vite 7                             |
| State          | Zustand (subscribeWithSelector)    |
| Drag & Drop    | @dnd-kit/core + @dnd-kit/sortable  |
| Styling        | Tailwind CSS v4                    |
| IDs            | uuid v4                            |

### Folder structure

```
src/
  types/
    index.ts           All types: Timeline, Pipeline, Pass, Step, ResourceLibrary, …
  state/
    store.ts           Zustand store — timeline/pass/step/resource CRUD, IO
  data/
    seed.ts            Seeded example (Graphics + Async Compute timelines)
  utils/
    id.ts              newId() helper
    dependencyGraph.ts deriveDependencies(), getPassDependencies(), getResourceUsage()
  validation/
    index.ts           Full validation: timelines, passes, steps, resources, cycles
  components/
    AppShell.tsx           3+1 panel layout with resizable dividers
    DependencyPanel.tsx    Derived dependency edge list (All/Cross-TL/Focused filters)
    ValidationPanel.tsx    Live validation errors/warnings
    JsonPreviewPanel.tsx   JSON import/export with inline edit mode
    ui/                    Badge, Button, Input, Select, Panel, TagsInput,
                           ResourceSelect, MultiResourceSelect
  features/
    pipeline/
      PipelineSidebar.tsx  Timeline columns with sortable pass lists per timeline
    pass/
      PassInspector.tsx    Pass properties + derived dependency section
    step/
      StepList.tsx         Sortable step list with typed Add Step menu (13 types)
      StepInspector.tsx    Per-type step editor
      editors/             DrawBatch, DispatchCompute, RT, Fullscreen, Transfer, etc.
    resources/
      ResourceEditor.tsx   Resource CRUD + Resource Usage Map (W/R per pass/timeline)
```

### Data model

```typescript
interface Pipeline {
  id: string;
  name: string;
  version: number;
  timelines: Timeline[];          // ordered list of timelines
  passes: Record<PassId, Pass>;  // normalized map (order is in Timeline.passIds)
  steps:  Record<StepId, Step>;  // normalized map (order is in Pass.steps)
}

interface Timeline {
  id: TimelineId;
  name: string;
  type: TimelineType;  // 'graphics' | 'asyncCompute' | 'transfer' | 'raytracing' | 'custom'
  passIds: PassId[];   // ordered pass sequence for this timeline
}

interface Pass {
  id: PassId;
  timelineId: TimelineId;
  name: string;
  kind: PassKind;     // 'raster' | 'compute' | 'transfer' | 'raytracing'
  enabled: boolean;
  conditions: string[];
  reads: ResourceId[];
  writes: ResourceId[];
  steps: StepId[];
  rasterAttachments?: RasterAttachments;
  notes?: string;
}
```

### Dependency derivation (`src/utils/dependencyGraph.ts`)

Dependencies are derived by scanning all pass `reads[]` and `writes[]`:

| Rule | Description |
|------|-------------|
| **WAR** (write-after-read) | Pass A writes R, Pass B reads R → B depends on A |
| **WAW** (write-after-write, same timeline) | Pass A writes R, Pass B (later) writes R → B depends on A |
| **Cross-timeline WAR** | Any cross-timeline write→read always generates a dependency edge (implies semaphore/barrier) |

The result is a list of `DependencyEdge` objects:

```typescript
interface DependencyEdge {
  fromPassId: PassId;
  toPassId: PassId;
  resourceIds: ResourceId[];   // which resources caused this edge
  isCrossTimeline: boolean;
  fromTimelineId: TimelineId;
  toTimelineId: TimelineId;
}
```

This is computed on-the-fly (not stored), visible in:
- **Pass Inspector** → "Dependencies (derived)" section
- **Dependencies tab** in the bottom panel (All / Cross-TL / Focused filters)

### Seeded example

A deferred lighting pipeline split across two timelines:

**Graphics timeline:**
1. Shadow Maps — renders 4-cascade CSM
2. GBuffer — albedo + normals + depth fill
3. Tonemap & Composite — ACES + bloom → LDR *(waits on async compute)*
4. Debug Overlay *(conditional: DebugLinesEnabled)*

**Async Compute timeline:**
1. GPU Culling — populates draw indirect buffer
2. SSAO *(conditional: EnableAO)* — reads GBuffer from Graphics (**cross-timeline sync**)
3. Deferred Lighting — reads GBuffer + shadow + AO (**cross-timeline sync**)
4. Bloom *(conditional: EnableBloom)* — reads HDR color

**Cross-timeline sync points derived automatically:**
- SSAO → depends on GBuffer (reads `GBuffer_Depth`, `GBuffer_Normal`)
- Lighting → depends on Shadow Maps (reads `ShadowMap`), GBuffer, and SSAO
- Tonemap → depends on Lighting (reads `HDR_Color`) and Bloom (reads `Bloom_Chain`)

### JSON format (v2)

```json
{
  "pipeline": {
    "id": "pipeline-main",
    "name": "MainRenderPipeline",
    "version": 2,
    "timelines": [
      { "id": "tl-graphics", "name": "Graphics", "type": "graphics", "passIds": ["..."] },
      { "id": "tl-async-compute", "name": "Async Compute", "type": "asyncCompute", "passIds": ["..."] }
    ],
    "passes": { "pass-id": { "timelineId": "tl-graphics", ... } },
    "steps":  { "step-id": { ... } }
  },
  "resources": { "renderTargets": [...], "buffers": [...], "blendStates": [...], "shaders": [...], "inputParameters": [...] }
}
```

### Keyboard shortcuts

- **Double-click** pass/timeline name → inline rename
- **Enter / Escape** → confirm / cancel rename
- **Drag handle (⠿)** → reorder passes within a timeline
- **↔ button** (hover pass) → move pass to another timeline
