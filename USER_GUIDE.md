# Render Graph Editor — User Guide

## Overview

The Render Graph Editor is a visual tool for designing GPU render pipelines. It lets you arrange render passes across multiple timeline tracks, define resource lifetimes, set up synchronisation between passes, and estimate VRAM usage — all with a live JSON document underneath.

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  Header bar  (pipeline name · examples · JSON toggle)   │
├────────────────────────────────────────┬────────────────┤
│                                        │                │
│         Timeline View                  │   Inspector    │
│   (timelines, passes, resources)       │    Panel       │
│                                        │                │
├────────────────────────────────────────┴────────────────┤
│  Status bar  (validation · VRAM · quick stats)          │
└─────────────────────────────────────────────────────────┘
```

The **Inspector panel** on the right can be resized by dragging its left border, and collapsed/expanded with the ◀/▶ tab on the far right edge.

---

## Header Bar

| Control | Action |
|---|---|
| Pipeline name | Double-click to rename |
| `v1.0` label | Shows the document version |
| Example switcher | Load a sample pipeline (`newrg`, `deferred`, …) |
| `{ }` button | Toggle the JSON viewer overlay |

---

## Timeline View

### Timelines

Timelines represent GPU queues or execution tracks (Graphics, Async Compute, Transfer, Ray Tracing, Custom).

- **Add** — Click **+ Timeline** in the toolbar, then pick a type.
- **Rename** — Double-click the timeline label on the left side.
- **Delete** — Hover the label and click **✕**. If the timeline has passes you will be asked to confirm.

The colour of each track (blue / green / orange / violet / grey) follows the timeline type.

### Passes

Each pass is a node on its timeline row.

**Adding a pass**

- Click the **+ Pass** button at the right end of any timeline row — the pass is appended at the end.
- **Right-click anywhere** in the timeline canvas → **Add Pass** context menu lists every timeline. The pass is inserted at the horizontal position of the click, not necessarily at the end.

**Selecting a pass**

Click a node. The Inspector panel updates to show its settings and the resource overlay highlights its reads/writes.

**Pass node quick actions (hover)**

Hovering a node reveals a small action bar above it:

| Button | Action |
|---|---|
| ✎ | Rename |
| ⧉ | Duplicate |
| ↔ | Move to another timeline (only shown when other timelines exist) |
| ✕ | Delete (confirms) |

**Right-click a pass node** for a context menu with the same actions plus **Enable / Disable**.

**Inline editing**

Double-click the pass name label directly on the node to rename it in-place.

### Reordering Passes

Drag the **⠿** handle on the left side of any pass node to reorder it within its timeline. A blue vertical line shows the drop position.

### Cross-Timeline Dependencies

Drag a pass and move the cursor into a **different** timeline row. The target row gets an amber dashed highlight and an amber line appears at the right edge of the pass that would become the dependency anchor (the rightmost pass whose centre is to the left of the cursor). Releasing the mouse creates a **manual dependency**: the dragged pass must execute after the anchor pass, with an amber arrow between them.

### Dependency Arrows

| Colour | Meaning |
|---|---|
| Grey | Same-timeline ordering (hidden by default — toggle **same-TL edges**) |
| Purple | Cross-timeline resource dependency (derived from reads/writes) |
| Amber | Manual dependency (drag-created or set in the Inspector) |

Hovering an arrow highlights it. Arrows connected to the selected pass are always highlighted.

The toolbar badge **N cross-TL sync** counts how many cross-timeline edges exist in the graph.

---

## Resource Overlay

Below the timeline tracks is a grid showing every render target and buffer alongside the passes that use them.

### Access Badges

Each cell where a pass touches a resource shows a badge:

| Badge | Meaning |
|---|---|
| **R** (blue) | Pass reads the resource |
| **W** (amber) | Pass writes the resource |
| **RW** (purple) | Pass both reads and writes |

Click a badge to select that pass.

### Lifetime Spans

A coloured bar spans from the first pass that uses a resource to the last, showing its lifetime on the GPU. Amber bars indicate dead writes (written but never read afterwards).

### Selecting Resources

Click a resource label row to select it. When a resource is selected:

- Its reads and writes are highlighted with ring colours on the pass nodes (amber = writer, blue = reader).
- Pass nodes that do not touch the resource are dimmed.

Hold **Ctrl / Cmd** and click to multi-select resources.

### Resource Toolbar

The small toolbar in the Resources section header (top of the overlay) has three buttons:

#### 🔍 Filter

Opens a filter panel with:

- **Name search** — type to filter by resource name.
- **Type chips** — restrict to Render Targets (▣ RT), Buffers (▤ Buffer), or Input Params (◆ Param).
- **Dead writes only** — show resources that are written but never read.
- **Unused only** — show resources not referenced by any pass.
- **Non-overlapping RTs only** — show render targets that have no temporal overlap with at least one other RT, making them candidates for **memory aliasing**. When this filter is active and you select a single RT, all RTs that overlap with it are dimmed; only aliasing candidates remain highlighted.

An active filter shows a blue dot on the filter button. Click **Clear all filters** inside the panel to reset.

#### ⇅ Sort

Choose how resource rows are ordered:

| Mode | Description |
|---|---|
| Manual (drag) | Drag rows to any order; ⠿ handles appear |
| First use | Sort by the leftmost pass that uses each resource |
| Last use | Sort by the rightmost pass |
| Longest span | Widest lifetime first |
| Shortest span | Narrowest lifetime first |

#### + Add

Creates a new **Render Target**, **Buffer**, or **Input Parameter**, and opens it in the Inspector immediately.

#### Right-click a resource row

Shows a context menu: **Bring to top** / **Bring to bottom** (works in Manual sort mode).

---

## Inspector Panel

The inspector on the right shows whichever item is currently selected: a pass, a step, or a resource. The header always reads **Inspector**.

### Pass Inspector

Sections:

**Identity**
- Name, Timeline (dropdown moves the pass), Kind (Raster / Compute / Transfer / Ray Tracing), Enabled toggle, Notes.

**Attachments** *(Raster passes only)*
- Add/remove **color attachments**: target render target, Load Op (Load / Clear / Don't Care), Store Op (Store / Don't Care), optional clear value (RGBA), optional blend state.
- Add/remove a **depth attachment**: target depth RT (d32f / d24s8 formats only), Load Op, Store Op, optional clear value.

**Resources**
- **Reads** and **Writes** multi-selects. These are what drive the automatic purple dependency arrows between passes.

**Conditions**
- Tag list of condition flags. Passes with conditions show small amber tags below their node and a counter on the Inspector summary.

**Steps**
- The ordered list of GPU commands inside this pass. Click any step to open the Step Inspector. Add new steps with the **+ Add Step** button; drag them to reorder.

**Dependencies**
- *Manual* — Lists all manually created cross-timeline dependencies. Remove any with ✕. Add new ones via the dropdown (only shows passes from other timelines).
- *Derived* — Read-only view of the automatic dependencies computed from resource reads/writes.

---

### Step Inspector

Opens when you click a step in the Steps list.

**Back navigation** — A **◂ PassName** breadcrumb appears at the top; click it to return to the pass.

Sections:

**Identity** — Step name (editable), type (read-only).

**Type Settings** — Fields specific to the step type:

| Step type | Settings |
|---|---|
| Draw Batch / Draw Batch With Materials | Shader, material set, draw call params |
| Dispatch Compute | Compute shader, dispatch dimensions (X/Y/Z) |
| Dispatch Ray Tracing | Raygen shader, dimensions |
| Draw Fullscreen | Fragment shader |
| Copy / Blit / Resolve Image | Source and destination targets |
| Clear Images | Target list, clear values |
| Fill Buffer | Target buffer, fill value |
| Generate Mip Chain | Source texture |
| Viewport | Viewport rect parameters |
| Draw Debug Lines | Shader and params |

**Resources** — Per-step reads and writes (more granular than the pass-level lists).

**Conditions** — Step-level condition flags.

---

### Resource Inspector

Opens when you click a resource row or when a resource is the active selection.

**Render Target**
- Name, Format, Width / Height (enter a number or the expressions `viewport.width` / `viewport.height` for screen-relative sizing), Mip levels, Array layers.
- **Usage** section shows which passes read and write this RT.

**Buffer**
- Name, Size (bytes).
- Usage section.

**Input Parameter**
- Name, Type (Bool / Float / Uint / Int / Vec2–4 / Color), Default value.

**Shader**
- Name, Stage, File path.

**Blend State**
- Name, source/destination color & alpha blend factors, color & alpha blend ops.

---

## Status Bar

The bar at the bottom of the window has three zones.

### Validation (left)

Displays **✓ No issues**, or error/warning counts. Click it to open a popover listing every issue with its location (pass or resource name). Common issues include passes reading resources they do not write, missing attachment targets, and circular dependencies.

### VRAM Estimate (centre)

Shows the estimated GPU memory at **1080p**. Click to open the **Memory Stats** modal.

### Quick Stats (right)

`NTL · NP · NS · NRT` — timeline count, pass count, step count, render target count.

---

## Memory Stats Modal

Click the VRAM chip in the status bar to open this modal.

**Viewport Size** — Choose a preset (720p / 1080p / 1440p / 4K) or type a custom width × height. All RT sizes defined as `viewport.width` / `viewport.height` scale accordingly.

**Summary Cards**
- Total VRAM (all RTs + buffers simultaneously resident).
- Render Targets total + percentage of VRAM.
- Buffers total + percentage of VRAM.

A proportion bar shows the RT (blue) / Buffer (amber) split visually.

**Render Targets table** — Sorted by size (largest first). Columns: format, dimensions, mip count, layer count, inline size bar. A **✦** symbol marks fixed-size RTs (not viewport-scaled). Mip chains and array layers are included in the size calculation.

**Buffers table** — Sorted by size with an inline bar.

**Pipeline Overview** — Timeline count, total/enabled pass count, conditional pass count, step count, passes by kind, shaders by stage.

> Memory estimates assume all resources are simultaneously resident. Compressed format sizes use block-size approximations.

---

## JSON Viewer

Click **{ }** in the header to open a read-only panel showing the full pipeline document as formatted JSON. This reflects every edit in real time and is useful for verifying the structure before exporting.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Escape** | Deselect all (pass, step, resource) |
| **Double-click** pass name | Rename in-place |
| **Double-click** timeline label | Rename timeline |
| **Enter** (while renaming) | Confirm rename |
| **Escape** (while renaming) | Cancel rename |
| **Ctrl / Cmd + click** resource row | Add to resource multi-selection |
