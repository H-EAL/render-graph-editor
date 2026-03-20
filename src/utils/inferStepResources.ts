/**
 * Infer read/write resource sets for a step without relying on the manually
 * stored step.reads / step.writes arrays.
 *
 * Rules:
 *  raster           – writes = colour-attachment targets + depth target
 *                     reads  = shaderBindings values with read/read_write access
 *                              (if no descriptor, treat all bindings as reads)
 *  dispatchCompute  – reads  = bindings with 'read' | 'read_write'
 *                     writes = bindings with 'write' | 'read_write'
 *  dispatchRayTracing – same as dispatchCompute (raygen shader drives bindings)
 *  copyImage /
 *  blitImage /
 *  resolveImage     – reads  = [source], writes = [destination]
 *  clearImages      – writes = targets[].target
 *  fillBuffer       – writes = [target]
 *  generateMipChain – reads  = [target], writes  = [target]
 */

import type { Step, Pass, ResourceId, IfBlockStep, EnableIfStep, ValueSource } from "../types";
import type { ShaderDescriptor } from "./shaderApi";
import { collectValueSourceResourceIds } from "./valueSource";

export interface StepResources {
    reads: ResourceId[];
    writes: ResourceId[];
}

function unique(ids: (ResourceId | undefined)[]): ResourceId[] {
    return [...new Set(ids.filter((id): id is ResourceId => !!id))];
}

/**
 * Resolve the set of resource IDs that a shader binding slot may reference.
 * If a fieldSelector exists for the slot it overrides (and fans out both
 * branches of a select); otherwise fall back to the static binding value.
 */
function resolveBindingIds(
    slotName: string,
    staticRid: ResourceId | undefined,
    fieldSelectors: Record<string, ValueSource> | undefined,
): ResourceId[] {
    const selector = fieldSelectors?.[slotName];
    if (selector) return collectValueSourceResourceIds(selector);
    return staticRid ? [staticRid] : [];
}

/**
 * Returns the inferred reads/writes for a single step.
 *
 * @param step        The step to analyse.
 * @param descriptor  Optional shader descriptor (for compute / RT / raster steps
 *                    that carry shader bindings). When null / undefined the
 *                    function falls back to treating all bindings as reads.
 */
export function inferStepResources(
    step: Step,
    descriptor?: ShaderDescriptor | null,
    stepsMap?: Record<string, Step>,
): StepResources {
    switch (step.type) {
        case "raster": {
            const writes: ResourceId[] = [];
            const readSet = new Set<ResourceId>();

            // Color attachments: always write; also read if loadOp === "load"
            for (const att of step.attachments.colorAttachments) {
                if (att.target) {
                    writes.push(att.target);
                    if (att.loadOp === "load") readSet.add(att.target);
                }
            }
            // Depth attachment: always write; also read if loadOp === "load"
            const dep = step.attachments.depthAttachment;
            if (dep?.target) {
                writes.push(dep.target);
                if (dep.loadOp === "load") readSet.add(dep.target);
            }

            // Reads: shader bindings on each draw-batch command, guided by the descriptor.
            // (The descriptor here would belong to the draw-batch shader, but at the pass
            //  level we may not have it — fall back to stored step.reads for now.)
            for (const cmd of step.commands) {
                if (cmd.type === "drawBatch") {
                    if (cmd.shaderBindings) {
                        for (const [slotName, rid] of Object.entries(cmd.shaderBindings)) {
                            if (!rid) continue;
                            if (!descriptor) {
                                readSet.add(rid);
                            } else {
                                const slot = descriptor.renderTargetSlots.find(
                                    (s) => s.name === slotName,
                                );
                                const access = slot?.access ?? "read";
                                if (access === "read" || access === "read_write") readSet.add(rid);
                            }
                        }
                    }
                    // materialInputs RT entries (string values) are always reads
                    if (cmd.materialInputs) {
                        for (const val of Object.values(cmd.materialInputs)) {
                            if (typeof val === "string" && val) readSet.add(val);
                        }
                    }
                }
            }
            // Resolve attachments: source is read, destination is written
            for (const ra of step.attachments.resolveAttachments ?? []) {
                if (ra.source) readSet.add(ra.source);
                if (ra.destination) writes.push(ra.destination);
            }
            // Carry over any manually stored reads/writes not covered by structured data
            for (const r of step.reads ?? []) readSet.add(r);
            for (const w of step.writes ?? []) writes.push(w);

            return { reads: [...readSet], writes: unique(writes) };
        }

        case "dispatchCompute":
        case "dispatchComputeDecals": {
            const bindings = step.shaderBindings ?? {};
            const reads: ResourceId[] = [];
            const writes: ResourceId[] = [];

            // Collect all slot names: static bindings + any extra selector-only slots
            const allSlotNames = new Set([
                ...Object.keys(bindings),
                ...Object.keys(step.fieldSelectors ?? {}),
            ]);

            for (const slotName of allSlotNames) {
                const ids = resolveBindingIds(slotName, bindings[slotName], step.fieldSelectors);
                if (ids.length === 0) continue;
                const slot = descriptor?.renderTargetSlots.find((s) => s.name === slotName);
                const access = slot?.access ?? step.shaderBindingAccess?.[slotName] ?? "read";
                for (const id of ids) {
                    if (access === "read" || access === "read_write") reads.push(id);
                    if (access === "write" || access === "read_write") writes.push(id);
                }
            }

            return { reads: unique(reads), writes: unique(writes) };
        }

        case "dispatchRayTracing": {
            const bindings = step.shaderBindings ?? {};
            const reads: ResourceId[] = [];
            const writes: ResourceId[] = [];

            const allSlotNames = new Set([
                ...Object.keys(bindings),
                ...Object.keys(step.fieldSelectors ?? {}),
            ]);

            for (const slotName of allSlotNames) {
                const ids = resolveBindingIds(slotName, bindings[slotName], step.fieldSelectors);
                if (ids.length === 0) continue;
                const slot = descriptor?.renderTargetSlots.find((s) => s.name === slotName);
                const access = slot?.access ?? step.shaderBindingAccess?.[slotName] ?? "read";
                for (const id of ids) {
                    if (access === "read" || access === "read_write") reads.push(id);
                    if (access === "write" || access === "read_write") writes.push(id);
                }
            }

            return { reads: unique(reads), writes: unique(writes) };
        }

        case "copyImage":
        case "blitImage":
        case "resolveImage":
            return {
                reads: unique([step.source]),
                writes: unique([step.destination]),
            };

        case "clearImages":
            return {
                reads: [],
                writes: unique(step.targets.map((t) => t.target)),
            };

        case "fillBuffer":
            return {
                reads: [],
                writes: unique([step.target]),
            };

        case "generateMipChain": {
            const id = step.target;
            return { reads: unique([id]), writes: unique([id]) };
        }

        case "ifBlock": {
            // Union resources from both branches (we can't know which branch runs)
            const ib = step as IfBlockStep;
            const reads = new Set<ResourceId>();
            const writes = new Set<ResourceId>();
            for (const sid of [...ib.thenSteps, ...ib.elseSteps]) {
                const child = stepsMap?.[sid];
                if (!child) continue;
                const { reads: r, writes: w } = inferStepResources(child, descriptor, stepsMap);
                r.forEach((id) => reads.add(id));
                w.forEach((id) => writes.add(id));
            }
            return { reads: [...reads], writes: [...writes] };
        }

        case "enableIf": {
            const ei = step as EnableIfStep;
            const reads = new Set<ResourceId>();
            const writes = new Set<ResourceId>();
            for (const sid of ei.thenSteps) {
                const child = stepsMap?.[sid];
                if (!child) continue;
                const { reads: r, writes: w } = inferStepResources(child, descriptor, stepsMap);
                r.forEach((id) => reads.add(id));
                w.forEach((id) => writes.add(id));
            }
            return { reads: [...reads], writes: [...writes] };
        }

        default:
            return { reads: [], writes: [] };
    }
}

/**
 * Returns a map from ResourceId → human-readable origin strings describing which
 * step / command caused the resource to appear in reads or writes.
 *
 * Each entry in the array is one line of the tooltip, e.g.
 *   "Main Opaque → Static Single Sided  [materialInput: ssao_rt]"
 *   "Main Opaque  [colorAttachment 0]"
 */
export function buildResourceOrigins(
    pass: Pass,
    steps: Record<string, Step>,
): Map<ResourceId, string[]> {
    const origins = new Map<ResourceId, string[]>();

    function add(rid: ResourceId | undefined, label: string) {
        if (!rid) return;
        if (!origins.has(rid)) origins.set(rid, []);
        origins.get(rid)!.push(label);
    }

    const allTopLevel = [
        ...pass.steps,
        ...(pass.disabledSteps ?? []),
        ...(pass.variants ?? []).flatMap((v) => v.activeSteps),
    ];

    for (const stepId of allTopLevel) {
        const step = steps[stepId];
        if (!step) continue;
        const sn = step.name;

        switch (step.type) {
            case "raster": {
                // Track which RIDs are covered by structured data to catch
                // any remaining manually-stored step.reads / step.writes
                const covered = new Set<ResourceId>();

                step.attachments.colorAttachments.forEach((att, i) => {
                    if (att.target) { add(att.target, `${sn}  [colorAttachment ${i}]`); covered.add(att.target); }
                });
                if (step.attachments.depthAttachment?.target) {
                    add(step.attachments.depthAttachment.target, `${sn}  [depthAttachment]`);
                    covered.add(step.attachments.depthAttachment.target);
                }
                step.attachments.resolveAttachments?.forEach((ra) => {
                    add(ra.source, `${sn}  [resolveSource → ${ra.destination}]`);
                    add(ra.destination, `${sn}  [resolveDestination ← ${ra.source}]`);
                    covered.add(ra.source);
                    covered.add(ra.destination);
                });

                for (const cmd of step.commands) {
                    if (cmd.type !== "drawBatch") continue;
                    const cn = cmd.name;
                    for (const [slot, rid] of Object.entries(cmd.shaderBindings ?? {})) {
                        add(rid, `${sn} → ${cn}  [shaderBinding: ${slot}]`);
                        covered.add(rid);
                    }
                    for (const [slot, val] of Object.entries(cmd.materialInputs ?? {}))
                        if (typeof val === "string") {
                            add(val, `${sn} → ${cn}  [materialInput: ${slot}]`);
                            covered.add(val);
                        }
                }

                // Fallback: any step.reads/writes not yet explained
                for (const r of step.reads ?? [])
                    if (!covered.has(r)) add(r, `${sn}  [read]`);
                for (const w of step.writes ?? [])
                    if (!covered.has(w)) add(w, `${sn}  [write]`);
                break;
            }
            case "dispatchCompute":
            case "dispatchComputeDecals":
            case "dispatchRayTracing": {
                const allSlotNames = new Set([
                    ...Object.keys(step.shaderBindings ?? {}),
                    ...Object.keys(step.fieldSelectors ?? {}),
                ]);
                for (const slot of allSlotNames) {
                    const ids = resolveBindingIds(slot, step.shaderBindings?.[slot], step.fieldSelectors);
                    for (const rid of ids) add(rid, `${sn}  [shaderBinding: ${slot}]`);
                }
                break;
            }
            case "copyImage":
            case "blitImage":
            case "resolveImage":
                add(step.source, `${sn}  [source]`);
                add(step.destination, `${sn}  [destination]`);
                break;
            case "clearImages":
                for (const t of step.targets) add(t.target, `${sn}  [clearTarget]`);
                break;
            case "fillBuffer":
                add(step.target, `${sn}  [target]`);
                break;
            case "generateMipChain":
                add(step.target, `${sn}  [mipTarget]`);
                break;
            case "ifBlock": {
                const ib = step as IfBlockStep;
                for (const sid of [...ib.thenSteps, ...ib.elseSteps]) {
                    const child = steps[sid];
                    if (!child) continue;
                    const { reads: r, writes: w } = inferStepResources(child, null, steps);
                    r.forEach((rid) => add(rid, `${sn} → ${child.name}  [ifBlock branch]`));
                    w.forEach((rid) => add(rid, `${sn} → ${child.name}  [ifBlock branch]`));
                }
                break;
            }
            case "enableIf": {
                const ei = step as EnableIfStep;
                for (const sid of ei.thenSteps) {
                    const child = steps[sid];
                    if (!child) continue;
                    const { reads: r, writes: w } = inferStepResources(child, null, steps);
                    r.forEach((rid) => add(rid, `${sn} → ${child.name}  [enableIf]`));
                    w.forEach((rid) => add(rid, `${sn} → ${child.name}  [enableIf]`));
                }
                break;
            }
        }
    }

    return origins;
}

/**
 * Returns the union of resources inferred across all steps that belong to a pass
 * (base active steps, fallback steps, and all variant active steps).
 */
export function inferPassResources(pass: Pass, steps: Record<string, Step>): StepResources {
    const reads = new Set<ResourceId>();
    const writes = new Set<ResourceId>();

    const allTopLevel = [
        ...pass.steps,
        ...(pass.disabledSteps ?? []),
        ...(pass.variants ?? []).flatMap((v) => v.activeSteps),
    ];

    for (const stepId of allTopLevel) {
        const step = steps[stepId];
        if (!step) continue;
        const { reads: r, writes: w } = inferStepResources(step, null, steps);
        r.forEach((id) => reads.add(id));
        w.forEach((id) => writes.add(id));
    }

    return { reads: [...reads], writes: [...writes] };
}
