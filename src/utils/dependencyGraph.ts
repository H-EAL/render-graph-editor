import type { Pipeline, PassId, ResourceId, TimelineId } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DependencyEdge {
  id: string;
  fromPassId: PassId;
  toPassId: PassId;
  /** Resources that created this dependency edge */
  resourceIds: ResourceId[];
  isCrossTimeline: boolean;
  fromTimelineId: TimelineId;
  toTimelineId: TimelineId;
  isManual?: boolean;
}

export interface PassDependencies {
  dependsOn: DependencyEdge[];    // edges where toPassId === this pass
  dependedOnBy: DependencyEdge[]; // edges where fromPassId === this pass
}

// ─── Core derivation ─────────────────────────────────────────────────────────

/**
 * Derives dependency edges from resource read/write declarations.
 *
 * Rules:
 *   WAR (Write→Read): if pass A writes resource R and pass B reads R,
 *       and B comes after A (same timeline) or B is on a different timeline,
 *       then B depends on A.
 *   WAW (Write→Write): if pass A and pass B both write resource R,
 *       and B comes after A on the same timeline, then B depends on A.
 *   Cross-timeline WAR: always generates a dependency (sync point needed).
 */
export function deriveDependencies(pipeline: Pipeline): DependencyEdge[] {
  const { timelines, passes } = pipeline;

  // Build index: passId → { timelineId, indexInTimeline }
  interface PassPos {
    timelineId: TimelineId;
    idx: number;
  }
  const passPos = new Map<PassId, PassPos>();
  for (const tl of timelines) {
    tl.passIds.forEach((pid, idx) => {
      passPos.set(pid, { timelineId: tl.id, idx });
    });
  }

  // Collect per-resource write and read lists
  interface AccessInfo {
    passId: PassId;
    timelineId: TimelineId;
    idx: number;
  }
  const writes = new Map<ResourceId, AccessInfo[]>();
  const reads  = new Map<ResourceId, AccessInfo[]>();

  for (const pass of Object.values(passes)) {
    const pos = passPos.get(pass.id);
    if (!pos) continue;
    const info: AccessInfo = { passId: pass.id, ...pos };

    for (const rid of pass.writes) {
      if (!writes.has(rid)) writes.set(rid, []);
      writes.get(rid)!.push(info);
    }
    for (const rid of pass.reads) {
      if (!reads.has(rid)) reads.set(rid, []);
      reads.get(rid)!.push(info);
    }
  }

  // Accumulate edges, merging per (from→to) pair
  const edgeMap = new Map<string, DependencyEdge>();

  const addEdge = (from: AccessInfo, to: AccessInfo, resourceId: ResourceId) => {
    if (from.passId === to.passId) return;
    const key = `${from.passId}->${to.passId}`;
    const existing = edgeMap.get(key);
    if (existing) {
      if (!existing.resourceIds.includes(resourceId)) existing.resourceIds.push(resourceId);
    } else {
      edgeMap.set(key, {
        id: key,
        fromPassId: from.passId,
        toPassId: to.passId,
        resourceIds: [resourceId],
        isCrossTimeline: from.timelineId !== to.timelineId,
        fromTimelineId: from.timelineId,
        toTimelineId: to.timelineId,
      });
    }
  };

  const allResources = new Set([...writes.keys(), ...reads.keys()]);

  for (const rid of allResources) {
    const wList = writes.get(rid) ?? [];
    const rList = reads.get(rid) ?? [];

    // WAR: writer → reader
    for (const w of wList) {
      for (const r of rList) {
        const sameTL = r.timelineId === w.timelineId;
        // Same timeline: only if reader comes strictly after writer
        if (sameTL && r.idx <= w.idx) continue;
        // Cross-timeline: always (bidirectional consideration — we can't know relative order)
        addEdge(w, r, rid);
      }
    }

    // WAW (same timeline only — two passes both writing the same resource)
    for (let i = 0; i < wList.length; i++) {
      for (let j = i + 1; j < wList.length; j++) {
        const w1 = wList[i], w2 = wList[j];
        if (w1.timelineId !== w2.timelineId) continue;
        if (w2.idx > w1.idx) addEdge(w1, w2, rid);
        else if (w1.idx > w2.idx) addEdge(w2, w1, rid);
      }
    }
  }

  // Manual dependencies: pass.manualDeps lists passes that this pass comes AFTER
  for (const pass of Object.values(passes)) {
    const toPos = passPos.get(pass.id);
    if (!toPos) continue;
    for (const depPassId of (pass.manualDeps ?? [])) {
      const fromPos = passPos.get(depPassId);
      if (!fromPos) continue;
      const key = `${depPassId}->${pass.id}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: key,
          fromPassId: depPassId,
          toPassId: pass.id,
          resourceIds: [],
          isCrossTimeline: fromPos.timelineId !== toPos.timelineId,
          fromTimelineId: fromPos.timelineId,
          toTimelineId: toPos.timelineId,
          isManual: true,
        });
      } else {
        // If a resource-inferred edge already exists for the same pair, mark it as also manual
        edgeMap.get(key)!.isManual = true;
      }
    }
  }

  return Array.from(edgeMap.values());
}

// ─── Per-pass view ────────────────────────────────────────────────────────────

export function getPassDependencies(
  passId: PassId,
  edges: DependencyEdge[]
): PassDependencies {
  return {
    dependsOn:    edges.filter((e) => e.toPassId   === passId),
    dependedOnBy: edges.filter((e) => e.fromPassId === passId),
  };
}

// ─── Resource usage ───────────────────────────────────────────────────────────

export interface ResourceUsage {
  resourceId: ResourceId;
  readers: Array<{ passId: PassId; passName: string; timelineId: TimelineId; timelineName: string }>;
  writers: Array<{ passId: PassId; passName: string; timelineId: TimelineId; timelineName: string }>;
}

export function getResourceUsage(pipeline: Pipeline): Map<ResourceId, ResourceUsage> {
  const { timelines, passes } = pipeline;

  const timelineNames = new Map<TimelineId, string>(timelines.map((tl) => [tl.id, tl.name]));

  const result = new Map<ResourceId, ResourceUsage>();
  const getOrCreate = (rid: ResourceId): ResourceUsage => {
    if (!result.has(rid)) result.set(rid, { resourceId: rid, readers: [], writers: [] });
    return result.get(rid)!;
  };

  for (const pass of Object.values(passes)) {
    const timelineName = timelineNames.get(pass.timelineId) ?? pass.timelineId;
    const passInfo = { passId: pass.id, passName: pass.name, timelineId: pass.timelineId, timelineName };
    for (const rid of pass.writes) getOrCreate(rid).writers.push(passInfo);
    for (const rid of pass.reads)  getOrCreate(rid).readers.push(passInfo);
  }

  return result;
}
