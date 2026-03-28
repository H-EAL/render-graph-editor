/**
 * Analysis dependency graph: enriches the raw dependency edges from
 * `deriveDependencies` with typed hazard reasons and computes the
 * transitive reduction to identify the minimal necessary edge set.
 */

import type { Pipeline, PassId, ResourceId, Step } from "../types";
import { deriveDependencies } from "./dependencyGraph";
import { inferPassResources } from "./inferStepResources";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The hazard type that necessitates a dependency. */
export type DependencyReason = "WAR" | "WAW" | "manual";

/**
 * An enriched dependency edge with typed reasons and a transitive-redundancy
 * flag.  All fields from the raw DependencyEdge are preserved.
 */
export interface AnalysisEdge {
    fromPassId: PassId;
    toPassId: PassId;
    resourceIds: ResourceId[];
    isCrossTimeline: boolean;
    fromTimelineId: string;
    toTimelineId: string;
    isManual: boolean;
    /** Hazard types that apply (WAR = write→read, WAW = write→write). */
    reasons: DependencyReason[];
    /** True when another path of length ≥ 2 already implies this edge. */
    isRedundant: boolean;
}

export interface AnalysisGraph {
    /** All pass IDs visible in the pipeline (timeline-concatenated order). */
    passIds: PassId[];
    /** Complete annotated edge set (includes redundant transitive edges). */
    edges: AnalysisEdge[];
    /** Non-redundant edges only — the minimal DAG. */
    minimalEdges: AnalysisEdge[];
    /** incoming[passId] = minimal edges whose toPassId === passId */
    incoming: Map<PassId, AnalysisEdge[]>;
    /** outgoing[passId] = minimal edges whose fromPassId === passId */
    outgoing: Map<PassId, AnalysisEdge[]>;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a typed, annotated dependency graph from the pipeline.
 *
 * Steps:
 *  1. Derive raw edges via `deriveDependencies` (WAR + WAW + manual).
 *  2. Classify each edge with `DependencyReason` flags using per-pass
 *     `inferPassResources` results.
 *  3. Compute the transitive reduction: mark each edge as `isRedundant` if
 *     the destination is reachable via a path of length ≥ 2 through the
 *     full adjacency.
 */
export function buildAnalysisGraph(pipeline: Pipeline): AnalysisGraph {
    const rawEdges = deriveDependencies(pipeline);

    // Per-pass inferred read/write sets for reason classification
    const passAccess = new Map<PassId, { reads: Set<ResourceId>; writes: Set<ResourceId> }>();
    for (const pass of Object.values(pipeline.passes)) {
        const { reads, writes } = inferPassResources(pass, pipeline.steps as Record<string, Step>);
        passAccess.set(pass.id, { reads: new Set(reads), writes: new Set(writes) });
    }

    // Authored pass order (timelines in declared order)
    const passIds: PassId[] = pipeline.timelines
        .flatMap((tl) => tl.passIds)
        .filter((pid) => !!pipeline.passes[pid]);

    // Enrich each raw edge with typed reasons
    const edges: AnalysisEdge[] = rawEdges.map((raw) => {
        const fromAcc = passAccess.get(raw.fromPassId);
        const toAcc   = passAccess.get(raw.toPassId);
        const reasons = new Set<DependencyReason>();

        if (raw.isManual) reasons.add("manual");

        for (const rid of raw.resourceIds) {
            if (fromAcc?.writes.has(rid) && toAcc?.reads.has(rid))   reasons.add("WAR");
            if (fromAcc?.writes.has(rid) && toAcc?.writes.has(rid))  reasons.add("WAW");
        }
        // Fallback: edges with no resource-based reason are manual-only
        if (reasons.size === 0) reasons.add("manual");

        return {
            fromPassId:     raw.fromPassId,
            toPassId:       raw.toPassId,
            resourceIds:    raw.resourceIds,
            isCrossTimeline: raw.isCrossTimeline,
            fromTimelineId: raw.fromTimelineId,
            toTimelineId:   raw.toTimelineId,
            isManual:       raw.isManual ?? false,
            reasons:        [...reasons],
            isRedundant:    false,
        };
    });

    // Build full adjacency (all edges) for reachability check
    const adjFull = new Map<PassId, Set<PassId>>();
    for (const pid of passIds) adjFull.set(pid, new Set());
    for (const e of edges) adjFull.get(e.fromPassId)?.add(e.toPassId);

    /**
     * Returns true if `to` is reachable from `from` via a path of length ≥ 2
     * (i.e., the direct edge is transitively redundant).
     */
    function reachableIndirectly(from: PassId, to: PassId): boolean {
        const visited = new Set<PassId>();
        // Seed BFS with from's neighbours, but NOT the direct hop to `to`
        const queue: PassId[] = [];
        for (const n of adjFull.get(from) ?? []) {
            if (n !== to && !visited.has(n)) { visited.add(n); queue.push(n); }
        }
        let i = 0;
        while (i < queue.length) {
            const cur = queue[i++];
            if (cur === to) return true;
            for (const n of adjFull.get(cur) ?? []) {
                if (!visited.has(n)) { visited.add(n); queue.push(n); }
            }
        }
        return false;
    }

    for (const edge of edges) {
        edge.isRedundant = reachableIndirectly(edge.fromPassId, edge.toPassId);
    }

    const minimalEdges = edges.filter((e) => !e.isRedundant);

    // Adjacency indices for the minimal graph
    const incoming = new Map<PassId, AnalysisEdge[]>();
    const outgoing = new Map<PassId, AnalysisEdge[]>();
    for (const pid of passIds) { incoming.set(pid, []); outgoing.set(pid, []); }
    for (const e of minimalEdges) {
        incoming.get(e.toPassId)?.push(e);
        outgoing.get(e.fromPassId)?.push(e);
    }

    return { passIds, edges, minimalEdges, incoming, outgoing };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the edge between two passes (full set, not just minimal). */
export function findEdge(
    graph: AnalysisGraph,
    fromPassId: PassId,
    toPassId: PassId,
): AnalysisEdge | undefined {
    return graph.edges.find((e) => e.fromPassId === fromPassId && e.toPassId === toPassId);
}
