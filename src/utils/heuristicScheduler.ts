/**
 * Heuristic topological scheduler for the render graph.
 *
 * At each step the scheduler:
 *   1. Gathers all passes whose dependencies are already scheduled (ready set).
 *   2. Scores each candidate using a weighted combination of:
 *        – critical-path cost  (higher → schedule earlier)
 *        – memory freed        (higher → schedule earlier)
 *        – memory allocated    (higher → schedule later, penalty)
 *        – slack               (zero → schedule earlier)
 *        – authored-order bias (earlier authored → slight preference)
 *   3. Picks the highest-scoring candidate and records the decision.
 *
 * The result is advisory — it never mutates the pipeline.
 */

import type { Pipeline, PassId } from "../types";
import type { AnalysisGraph } from "./analysisGraph";
import type { ExecutionMetrics } from "./executionMetrics";
import { formatBytes } from "./memoryStats";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledPass {
    passId: PassId;
    passName: string;
    timelineId: string;
    /** 0-based position in the suggested sequence. */
    scheduleIndex: number;
    /** Final composite score used to select this pass. */
    score: number;
    scoreBreakdown: {
        criticalPathCost: number;
        memoryFreedBytes: number;
        memoryAllocatedPenalty: number;
        slackBonus: number;
        authoredOrderBias: number;
    };
    /** One-sentence human-readable explanation. */
    rationale: string;
    /** All passes that were ready at this step (incl. the chosen one). */
    candidatePassIds: PassId[];
}

export interface ScheduleResult {
    passes: ScheduledPass[];
    orderedPassIds: PassId[];
    /** How many passes appear in a different authored-order position. */
    reorderedCount: number;
}

// ─── Heuristic weights ────────────────────────────────────────────────────────

const W = {
    criticalPath:  4.0,   // dominant: always prefer critical-path passes
    memoryFreed:   2.0,   // free memory soon to reduce peak pressure
    memoryAlloc:   1.0,   // penalty for allocating many new resources
    slack:         3.0,   // zero-slack bonus (urgency)
    authoredOrder: 0.5,   // mild tie-breaker: prefer earlier authored position
} as const;

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function computeHeuristicSchedule(
    graph: AnalysisGraph,
    metrics: ExecutionMetrics,
    pipeline: Pipeline,
): ScheduleResult {
    const { passIds } = graph;

    // Authored linear order (timelines concatenated)
    const authoredOrder = pipeline.timelines
        .flatMap((tl) => tl.passIds)
        .filter((pid) => !!pipeline.passes[pid]);
    const authoredIdx = new Map<PassId, number>();
    authoredOrder.forEach((pid, i) => authoredIdx.set(pid, i));
    const N = Math.max(1, authoredOrder.length);

    // Normalisation denominators
    const maxCPC = Math.max(
        1,
        ...passIds.map((pid) => metrics.perPass.get(pid)?.criticalPathCost ?? 0),
    );
    const maxMem = Math.max(
        1,
        ...passIds.flatMap((pid) => {
            const m = metrics.perPass.get(pid);
            return m ? [m.memoryFreedBytes, m.memoryAllocatedBytes] : [];
        }),
    );

    // Mutable in-degree for ready-queue tracking
    const inDeg = new Map<PassId, number>();
    for (const pid of passIds) inDeg.set(pid, graph.incoming.get(pid)?.length ?? 0);

    const scheduled = new Set<PassId>();
    const passes: ScheduledPass[] = [];

    while (scheduled.size < passIds.length) {
        // ── Gather ready passes ─────────────────────────────────────────────
        let candidates = passIds.filter(
            (pid) => !scheduled.has(pid) && (inDeg.get(pid) ?? 0) === 0,
        );
        if (candidates.length === 0) {
            // Cycle fallback: force-schedule the first remaining pass
            const remaining = passIds.filter((pid) => !scheduled.has(pid));
            if (remaining.length === 0) break;
            inDeg.set(remaining[0], 0);
            candidates = [remaining[0]];
        }

        // ── Score each candidate ────────────────────────────────────────────
        const scored = candidates.map((pid) => {
            const m = metrics.perPass.get(pid)!;

            const cpScore  = W.criticalPath  * (m.criticalPathCost        / maxCPC);
            const mfScore  = W.memoryFreed   * (m.memoryFreedBytes         / maxMem);
            const maPenalty = W.memoryAlloc  * (m.memoryAllocatedBytes     / maxMem);
            const slBonus  = W.slack         * (m.slack === 0 ? 1 : 0);
            const authIdx  = authoredIdx.get(pid) ?? N;
            const aoScore  = W.authoredOrder * (1 - authIdx / N);

            return {
                pid,
                total: cpScore + mfScore - maPenalty + slBonus + aoScore,
                breakdown: {
                    criticalPathCost:      cpScore,
                    memoryFreedBytes:      mfScore,
                    memoryAllocatedPenalty: maPenalty,
                    slackBonus:            slBonus,
                    authoredOrderBias:     aoScore,
                },
            };
        });

        scored.sort((a, b) => b.total - a.total);
        const best = scored[0];
        const m    = metrics.perPass.get(best.pid)!;

        // ── Build rationale ─────────────────────────────────────────────────
        let rationale: string;
        if (m.isCritical && m.criticalPathCost === metrics.criticalPathLength) {
            rationale = `Critical-path source (chain length ${m.criticalPathCost})`;
        } else if (m.isCritical) {
            rationale = `On critical path (cost ${m.criticalPathCost})`;
        } else if (m.slack === 0) {
            rationale = `Zero slack — must schedule now`;
        } else if (m.memoryFreedBytes > 0 && best.breakdown.memoryFreedBytes >= best.breakdown.criticalPathCost) {
            rationale = `Frees ${formatBytes(m.memoryFreedBytes)} of memory`;
        } else if (candidates.length === 1) {
            rationale = `Only ready pass at this step`;
        } else {
            rationale = `Authored order (slack ${m.slack})`;
        }

        passes.push({
            passId:        best.pid,
            passName:      pipeline.passes[best.pid]?.name ?? best.pid,
            timelineId:    m.timelineId,
            scheduleIndex: passes.length,
            score:         best.total,
            scoreBreakdown: best.breakdown,
            rationale,
            candidatePassIds: candidates,
        });

        scheduled.add(best.pid);

        // Decrement in-degrees of successors
        for (const e of graph.outgoing.get(best.pid) ?? []) {
            inDeg.set(e.toPassId, Math.max(0, (inDeg.get(e.toPassId) ?? 0) - 1));
        }
    }

    // ── Count reorderings (compare against authored order) ─────────────────
    const orderedPassIds = passes.map((p) => p.passId);
    let reorderedCount = 0;
    for (let i = 0; i < orderedPassIds.length; i++) {
        if ((authoredIdx.get(orderedPassIds[i]) ?? i) !== i) reorderedCount++;
    }

    return { passes, orderedPassIds, reorderedCount };
}
