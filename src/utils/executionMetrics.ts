/**
 * Critical-Path Method (CPM) execution metrics for the render graph.
 *
 * Computes per-pass:
 *   – earliestLevel / latestLevel / slack
 *   – criticalPathCost (longest downstream chain)
 *   – upstream / downstream reachability sets
 *   – memory allocation / free estimates (bytes)
 */

import type { Pipeline, ResourceLibrary, PassId, ResourceId, Step } from "../types";
import type { AnalysisGraph } from "./analysisGraph";
import { inferPassResources } from "./inferStepResources";
import { computeMemStats } from "./memoryStats";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PassMetrics {
    passId: PassId;
    passName: string;
    timelineId: string;
    timelineName: string;

    // ── CPM scheduling fields ──────────────────────────────────────────────
    /** Longest path length from any source to this pass (0-based levels). */
    earliestLevel: number;
    /** Latest this pass can start without delaying the project completion. */
    latestLevel: number;
    /** latestLevel – earliestLevel. Zero means on the critical path. */
    slack: number;
    /** 1 + the length of the longest downstream path (chain cost). */
    criticalPathCost: number;
    /** True when slack === 0. */
    isCritical: boolean;
    /** Position in the computed topological order. */
    topologicalIndex: number;

    // ── Connectivity ───────────────────────────────────────────────────────
    inDegree: number;
    outDegree: number;
    upstreamIds: Set<PassId>;
    downstreamIds: Set<PassId>;

    // ── Memory pressure estimates ──────────────────────────────────────────
    /** Bytes of resources first written by this pass (allocation point). */
    memoryAllocatedBytes: number;
    /** Bytes of resources whose last consumer is this pass (free point). */
    memoryFreedBytes: number;
}

export interface ExecutionMetrics {
    perPass: Map<PassId, PassMetrics>;
    topologicalOrder: PassId[];
    /** Number of "levels" on the critical path (project completion time). */
    criticalPathLength: number;
    /** Pass IDs on the critical path, in topological order. */
    criticalPathPassIds: PassId[];
    /** True if a dependency cycle was detected (metrics may be approximate). */
    hasCycle: boolean;
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeExecutionMetrics(
    graph: AnalysisGraph,
    pipeline: Pipeline,
    resources: ResourceLibrary,
): ExecutionMetrics {
    const { passIds, incoming, outgoing } = graph;

    // ── Resource byte sizes ────────────────────────────────────────────────
    const memStats = computeMemStats(resources, pipeline, { w: 1920, h: 1080 });
    const resBytes = new Map<ResourceId, number>();
    for (const rt  of memStats.renderTargets) resBytes.set(rt.id,  rt.bytes);
    for (const buf of memStats.buffers)        resBytes.set(buf.id, buf.bytes);

    // ── Topological sort (Kahn's algorithm on minimal edges) ───────────────
    const inDeg = new Map<PassId, number>();
    for (const pid of passIds) inDeg.set(pid, incoming.get(pid)?.length ?? 0);

    const topoOrder: PassId[] = [];
    const queue: PassId[] = passIds.filter((pid) => (inDeg.get(pid) ?? 0) === 0);
    let hasCycle = false;

    while (queue.length > 0) {
        const pid = queue.shift()!;
        topoOrder.push(pid);
        for (const e of outgoing.get(pid) ?? []) {
            const d = (inDeg.get(e.toPassId) ?? 0) - 1;
            inDeg.set(e.toPassId, d);
            if (d === 0) queue.push(e.toPassId);
        }
    }
    if (topoOrder.length < passIds.length) {
        hasCycle = true;
        // Append remaining (cyclic) passes so metrics stay computable
        for (const pid of passIds) if (!topoOrder.includes(pid)) topoOrder.push(pid);
    }

    // ── Forward pass: Earliest Level ───────────────────────────────────────
    const EL = new Map<PassId, number>();
    for (const pid of topoOrder) {
        const preds = incoming.get(pid) ?? [];
        EL.set(
            pid,
            preds.length === 0
                ? 0
                : Math.max(...preds.map((e) => (EL.get(e.fromPassId) ?? 0) + 1)),
        );
    }

    // Project completion = max(EL[v] + 1) across all passes
    const projectLength = topoOrder.length > 0
        ? Math.max(...topoOrder.map((pid) => (EL.get(pid) ?? 0) + 1))
        : 0;

    // ── Backward pass: Latest Level ────────────────────────────────────────
    const LL = new Map<PassId, number>();
    for (const pid of [...topoOrder].reverse()) {
        const succs = outgoing.get(pid) ?? [];
        LL.set(
            pid,
            succs.length === 0
                ? projectLength - 1
                : Math.min(...succs.map((e) => (LL.get(e.toPassId) ?? projectLength - 1) - 1)),
        );
    }

    // ── Critical path cost (longest downstream chain) ─────────────────────
    const CPC = new Map<PassId, number>();
    for (const pid of [...topoOrder].reverse()) {
        const succs = outgoing.get(pid) ?? [];
        CPC.set(
            pid,
            1 + (succs.length === 0
                ? 0
                : Math.max(...succs.map((e) => CPC.get(e.toPassId) ?? 0))),
        );
    }

    // ── Reachability: upstream and downstream ──────────────────────────────
    const upstream   = new Map<PassId, Set<PassId>>();
    const downstream = new Map<PassId, Set<PassId>>();
    for (const pid of passIds) { upstream.set(pid, new Set()); downstream.set(pid, new Set()); }

    // Forward: propagate upstream sets
    for (const pid of topoOrder) {
        const up = upstream.get(pid)!;
        for (const e of incoming.get(pid) ?? []) {
            up.add(e.fromPassId);
            for (const id of upstream.get(e.fromPassId) ?? []) up.add(id);
        }
    }
    // Backward: propagate downstream sets
    for (const pid of [...topoOrder].reverse()) {
        const dn = downstream.get(pid)!;
        for (const e of outgoing.get(pid) ?? []) {
            dn.add(e.toPassId);
            for (const id of downstream.get(e.toPassId) ?? []) dn.add(id);
        }
    }

    // ── Memory tracking ────────────────────────────────────────────────────
    const passAccess = new Map<PassId, { reads: ResourceId[]; writes: ResourceId[] }>();
    for (const pass of Object.values(pipeline.passes)) {
        const { reads, writes } = inferPassResources(pass, pipeline.steps as Record<string, Step>);
        passAccess.set(pass.id, { reads, writes });
    }

    // firstWriter[rid] = first pass in topo order that writes rid
    const firstWriter = new Map<ResourceId, PassId>();
    // lastUser[rid]   = last pass in topo order that reads or writes rid
    const lastUser    = new Map<ResourceId, PassId>();

    for (const pid of topoOrder) {
        const acc = passAccess.get(pid);
        if (!acc) continue;
        for (const rid of acc.writes) if (!firstWriter.has(rid)) firstWriter.set(rid, pid);
        for (const rid of [...acc.reads, ...acc.writes])          lastUser.set(rid, pid);
    }

    const memAllocated = new Map<PassId, number>();
    const memFreed     = new Map<PassId, number>();
    for (const pid of passIds) { memAllocated.set(pid, 0); memFreed.set(pid, 0); }

    for (const [rid, pid] of firstWriter) {
        memAllocated.set(pid, (memAllocated.get(pid) ?? 0) + (resBytes.get(rid) ?? 0));
    }
    for (const [rid, pid] of lastUser) {
        memFreed.set(pid, (memFreed.get(pid) ?? 0) + (resBytes.get(rid) ?? 0));
    }

    // ── Timeline name lookup ───────────────────────────────────────────────
    const tlNames  = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));
    const passTlId = new Map<PassId, string>();
    for (const tl of pipeline.timelines)
        for (const pid of tl.passIds) passTlId.set(pid, tl.id);

    // ── Assemble per-pass metrics ──────────────────────────────────────────
    const perPass = new Map<PassId, PassMetrics>();
    topoOrder.forEach((pid, topoIdx) => {
        const pass = pipeline.passes[pid];
        const el   = EL.get(pid) ?? 0;
        const ll   = LL.get(pid) ?? 0;
        const tlId = passTlId.get(pid) ?? pass?.timelineId ?? "";

        perPass.set(pid, {
            passId:    pid,
            passName:  pass?.name ?? pid,
            timelineId:   tlId,
            timelineName: tlNames.get(tlId) ?? tlId,

            earliestLevel:   el,
            latestLevel:     ll,
            slack:           Math.max(0, ll - el),
            criticalPathCost: CPC.get(pid) ?? 0,
            isCritical:      el === ll,
            topologicalIndex: topoIdx,

            inDegree:      incoming.get(pid)?.length ?? 0,
            outDegree:     outgoing.get(pid)?.length ?? 0,
            upstreamIds:   upstream.get(pid)   ?? new Set(),
            downstreamIds: downstream.get(pid) ?? new Set(),

            memoryAllocatedBytes: memAllocated.get(pid) ?? 0,
            memoryFreedBytes:     memFreed.get(pid)     ?? 0,
        });
    });

    const criticalPathPassIds = topoOrder.filter((pid) => perPass.get(pid)?.isCritical);

    return {
        perPass,
        topologicalOrder: topoOrder,
        criticalPathLength: projectLength,
        criticalPathPassIds,
        hasCycle,
    };
}
