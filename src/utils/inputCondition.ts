import type { InputCondition, InputDefinition, InputId, Pipeline, ResourceLibrary } from "../types";
import { inferPassResources } from "./inferStepResources";

// ─── Evaluation ───────────────────────────────────────────────────────────────

/** Evaluate a condition given a map of current input values. */
export function evaluateCondition(
    cond: InputCondition,
    values: Record<InputId, unknown>,
): boolean {
    switch (cond.type) {
        case "comparison": {
            const val = values[cond.leftInput];
            const rv = cond.rightValue;
            switch (cond.operator) {
                case "==": return val == rv; // eslint-disable-line eqeqeq
                case "!=": return val != rv; // eslint-disable-line eqeqeq
                case ">":  return (val as number) > (rv as number);
                case ">=": return (val as number) >= (rv as number);
                case "<":  return (val as number) < (rv as number);
                case "<=": return (val as number) <= (rv as number);
            }
        }
        case "and": return cond.conditions.every((c) => evaluateCondition(c, values));
        case "or":  return cond.conditions.some((c) => evaluateCondition(c, values));
        case "not": return !evaluateCondition(cond.condition, values);
    }
}

// ─── Dependency collection ────────────────────────────────────────────────────

/** Collect all InputIds referenced inside a condition (direct references only). */
export function collectConditionInputIds(cond: InputCondition): Set<InputId> {
    const ids = new Set<InputId>();
    function walk(c: InputCondition) {
        if (c.type === "comparison") { ids.add(c.leftInput); return; }
        if (c.type === "not") { walk(c.condition); return; }
        c.conditions.forEach(walk);
    }
    walk(cond);
    return ids;
}

// ─── Dependency graph ─────────────────────────────────────────────────────────

/** Map from InputId → set of InputIds that it depends on (via conditions). */
export function buildDependsOn(definitions: InputDefinition[]): Map<InputId, Set<InputId>> {
    return new Map(
        definitions.map((def) => {
            const deps = new Set<InputId>();
            for (const cond of [def.visibilityCondition, def.enabledCondition]) {
                if (cond) collectConditionInputIds(cond).forEach((id) => deps.add(id));
            }
            return [def.id, deps] as const;
        }),
    );
}

/** Map from InputId → set of InputIds that reference it in their conditions. */
export function buildUsedBy(definitions: InputDefinition[]): Map<InputId, Set<InputId>> {
    const result = new Map<InputId, Set<InputId>>(definitions.map((d) => [d.id, new Set()]));
    for (const def of definitions) {
        for (const cond of [def.visibilityCondition, def.enabledCondition]) {
            if (!cond) continue;
            for (const depId of collectConditionInputIds(cond)) {
                if (!result.has(depId)) result.set(depId, new Set());
                result.get(depId)!.add(def.id);
            }
        }
    }
    return result;
}

/** Returns true if adding a condition in `sourceId` that references `targetId` would create a cycle. */
export function wouldCreateCycle(
    definitions: InputDefinition[],
    sourceId: InputId,
    targetId: InputId,
): boolean {
    // BFS from targetId; if we can reach sourceId, it's a cycle
    const defMap = new Map(definitions.map((d) => [d.id, d]));
    const visited = new Set<InputId>();
    const queue = [targetId];
    while (queue.length) {
        const curr = queue.shift()!;
        if (curr === sourceId) return true;
        if (visited.has(curr)) continue;
        visited.add(curr);
        const def = defMap.get(curr);
        if (!def) continue;
        for (const cond of [def.visibilityCondition, def.enabledCondition]) {
            if (cond) collectConditionInputIds(cond).forEach((id) => queue.push(id));
        }
    }
    return false;
}

// ─── Pass usage ───────────────────────────────────────────────────────────────

/**
 * Returns all passes that reference the given input, either via pass/step
 * conditions (e.g. "hbao", "!opaque") or via shader bindings that resolve to
 * the matching InputParameter id. Each entry includes the usage kind.
 */
export function buildInputPassUsage(
    inputId: InputId,
    pipeline: Pipeline,
    resources: ResourceLibrary,
): Array<{ id: string; name: string; kind: "condition" | "data" | "both" }> {
    const ipId = resources.inputParameters.find((p) => p.name === inputId)?.id;
    const conditionMatch = (c: string) => c === inputId || c === `!${inputId}`;

    const result: Array<{ id: string; name: string; kind: "condition" | "data" | "both" }> = [];
    for (const pass of Object.values(pipeline.passes)) {
        // Condition reference (pass-level conditions already aggregate all node conditions)
        const usedInCondition = pass.conditions.some(conditionMatch);

        // Shader binding reference — delegate to inferPassResources which handles all
        // step types (raster cmd.shaderBindings, compute step.shaderBindings, materialInputs…)
        const usedInBindings =
            !!ipId && inferPassResources(pass, pipeline.steps).reads.includes(ipId);

        if (usedInCondition || usedInBindings) {
            const kind =
                usedInCondition && usedInBindings ? "both" : usedInCondition ? "condition" : "data";
            result.push({ id: pass.id, name: pass.name, kind });
        }
    }
    return result;
}

// ─── Default factories ────────────────────────────────────────────────────────

export function makeDefaultCondition(): InputCondition {
    return { type: "comparison", leftInput: "", operator: "==", rightValue: true };
}

export function makeDefaultGroup(type: "and" | "or"): InputCondition {
    return { type, conditions: [makeDefaultCondition()] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable summary of a condition (for collapsed display). */
export function summariseCondition(
    cond: InputCondition | undefined,
    labelOf: (id: InputId) => string,
): string {
    if (!cond) return "—";
    switch (cond.type) {
        case "comparison":
            return `${labelOf(cond.leftInput)} ${cond.operator} ${JSON.stringify(cond.rightValue)}`;
        case "and":
            return `ALL of (${cond.conditions.map((c) => summariseCondition(c, labelOf)).join(", ")})`;
        case "or":
            return `ANY of (${cond.conditions.map((c) => summariseCondition(c, labelOf)).join(", ")})`;
        case "not":
            return `NOT (${summariseCondition(cond.condition, labelOf)})`;
    }
}
