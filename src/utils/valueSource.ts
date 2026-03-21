/**
 * Utilities for the ValueSource / data-selector system.
 *
 * A ValueSource<T> lets a step field be driven by:
 *   - a hard-coded constant  (kind:"constant")
 *   - a graph InputParameter (kind:"input")
 *   - a boolean-select       (kind:"select")
 *
 * These helpers are shared by the editor UI, the inference engine,
 * and any future validation / export logic.
 */

import type { ValueSource, ResourceId, InputParameter } from "../types";

// ─── Resource collection ──────────────────────────────────────────────────────

/**
 * Recursively collect all ResourceId leaves that a ValueSource may resolve to
 * at runtime (both branches of a select are included).
 *
 * Only "constant" nodes whose value is a non-empty string are treated as
 * ResourceIds; "input" nodes reference InputParameters, not resources.
 */
export function collectValueSourceResourceIds(src: ValueSource): ResourceId[] {
    switch (src.kind) {
        case "constant":
            return typeof src.value === "string" && src.value ? [src.value as ResourceId] : [];
        case "input":
            return [];
        case "select":
            return [
                ...collectValueSourceResourceIds(src.trueValue),
                ...collectValueSourceResourceIds(src.falseValue),
            ];
    }
}

/**
 * Return the InputParameter names / IDs referenced by a ValueSource tree.
 * Used to mark inputs as "used" in the timeline.
 */
export function collectValueSourceInputRefs(src: ValueSource): string[] {
    switch (src.kind) {
        case "constant":
            return [];
        case "input":
            return [src.inputId];
        case "select": {
            const refs: string[] = [src.condition];
            refs.push(...collectValueSourceInputRefs(src.trueValue));
            refs.push(...collectValueSourceInputRefs(src.falseValue));
            return refs;
        }
    }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type FieldKind = "resource" | "bool" | "scalar";

export interface ValidationError {
    /** Short label for the field (slot name) */
    field: string;
    message: string;
}

/**
 * Validate a ValueSource against the set of known InputParameters.
 * Returns an array of error messages (empty = valid).
 */
export function validateValueSource(
    src: ValueSource,
    field: string,
    fieldKind: FieldKind,
    inputParameters: InputParameter[],
    resourceIds: Set<string>,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const paramByName = new Map(inputParameters.map((p) => [p.name, p]));
    const paramById = new Map(inputParameters.map((p) => [p.id, p]));

    function validate(vs: ValueSource, depth: number): void {
        switch (vs.kind) {
            case "constant": {
                if (fieldKind === "resource") {
                    const v = vs.value as string;
                    if (v && !resourceIds.has(v))
                        errors.push({ field, message: `Unknown resource "${v}"` });
                }
                break;
            }
            case "input": {
                const param = paramByName.get(vs.inputId) ?? paramById.get(vs.inputId);
                if (!param) {
                    errors.push({ field, message: `Unknown input "${vs.inputId}"` });
                } else if (fieldKind === "resource") {
                    errors.push({
                        field,
                        message: `Input "${vs.inputId}" is a scalar — cannot bind to a resource slot`,
                    });
                } else if (fieldKind === "bool" && param.type !== "bool") {
                    errors.push({
                        field,
                        message: `Input "${vs.inputId}" is ${param.type}, expected bool`,
                    });
                }
                break;
            }
            case "select": {
                if (depth > 2) {
                    errors.push({ field, message: "Selectors may not be nested more than 2 levels deep" });
                    break;
                }
                const cond = paramByName.get(vs.condition) ?? paramById.get(vs.condition);
                if (!cond) {
                    errors.push({ field, message: `Unknown condition "${vs.condition}"` });
                } else if (cond.type !== "bool") {
                    errors.push({
                        field,
                        message: `Condition "${vs.condition}" is ${cond.type}, expected bool`,
                    });
                }
                validate(vs.trueValue, depth + 1);
                validate(vs.falseValue, depth + 1);
                break;
            }
        }
    }

    validate(src, 0);
    return errors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap a plain value as a constant ValueSource. */
export function constant<T>(value: T): ValueSource<T> {
    return { kind: "constant", value };
}

/** Default ValueSource for a new selector based on field kind. */
export function defaultSelector(fieldKind: FieldKind): ValueSource {
    if (fieldKind === "resource") {
        return {
            kind: "select",
            condition: "",
            trueValue: { kind: "constant", value: "" },
            falseValue: { kind: "constant", value: "" },
        };
    }
    if (fieldKind === "bool") {
        return {
            kind: "select",
            condition: "",
            trueValue: { kind: "constant", value: true },
            falseValue: { kind: "constant", value: false },
        };
    }
    // scalar
    return {
        kind: "select",
        condition: "",
        trueValue: { kind: "constant", value: 0 },
        falseValue: { kind: "constant", value: 0 },
    };
}

/**
 * Resolve a ValueSource to a display label (for read-only summary chips).
 * Does not actually evaluate at runtime — just returns a human-readable string.
 */
export function summariseValueSource(
    src: ValueSource,
    resolveResource: (id: string) => string,
    depth = 0,
): string {
    switch (src.kind) {
        case "constant":
            if (typeof src.value === "string")
                return src.value ? resolveResource(src.value) : "—";
            return String(src.value);
        case "input":
            return src.inputId ? `↳ ${src.inputId}` : "—";
        case "select": {
            const t = summariseValueSource(src.trueValue, resolveResource, depth + 1);
            const f = summariseValueSource(src.falseValue, resolveResource, depth + 1);
            if (depth > 0) return `${src.condition}?${t}:${f}`;
            return `select(${src.condition}, ${t}, ${f})`;
        }
    }
}
