import type { Pipeline, ResourceLibrary, ValidationIssue, RasterStep, Step } from "../types";
import { deriveDependencies } from "../utils/dependencyGraph";
import { inferPassResources } from "../utils/inferStepResources";
import { newId } from "../utils/id";

export function validateDocument(
    pipeline: Pipeline,
    resources: ResourceLibrary,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const allResourceIds = new Set([
        ...resources.renderTargets.map((r) => r.id),
        ...resources.buffers.map((r) => r.id),
        ...resources.blendStates.map((r) => r.id),
        ...resources.shaders.map((r) => r.id),
        ...resources.inputParameters.map((r) => r.id),
    ]);

    // ── Timeline validation ──────────────────────────────────────────────────
    const timelineIds = new Set<string>();
    for (const tl of pipeline.timelines) {
        if (timelineIds.has(tl.id)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Duplicate timeline ID: "${tl.id}"`,
                location: "Timelines",
            });
        }
        timelineIds.add(tl.id);

        if (!tl.name.trim()) {
            issues.push({
                id: newId(),
                severity: "warning",
                message: `Timeline "${tl.id}" has no name`,
                location: "Timelines",
            });
        }
    }

    // ── Pass validation ──────────────────────────────────────────────────────
    const allTimelinePassIds = new Set(pipeline.timelines.flatMap((tl) => tl.passIds));

    const passIds = new Set<string>();
    for (const [pid, pass] of Object.entries(pipeline.passes)) {
        if (passIds.has(pid)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Duplicate pass ID: "${pid}"`,
                location: pass.name,
            });
        }
        passIds.add(pid);

        // Timeline reference valid?
        if (!timelineIds.has(pass.timelineId)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Pass "${pass.name}" references unknown timeline "${pass.timelineId}"`,
                location: pass.name,
            });
        }

        // Pass in timelines' passIds?
        if (!allTimelinePassIds.has(pid)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Pass "${pass.name}" exists in passes map but is not referenced by any timeline`,
                location: pass.name,
            });
        }

        // Empty pass warning
        if (pass.steps.length === 0 && pass.reads.length === 0 && pass.writes.length === 0) {
            issues.push({
                id: newId(),
                severity: "warning",
                message: `Pass "${pass.name}" has no steps and no resource accesses`,
                location: pass.name,
            });
        }

        // Read/write references
        for (const rid of pass.reads) {
            if (!allResourceIds.has(rid)) {
                issues.push({
                    id: newId(),
                    severity: "warning",
                    message: `Pass "${pass.name}" reads unknown resource "${rid}"`,
                    location: pass.name,
                });
            }
        }
        for (const rid of pass.writes) {
            if (!allResourceIds.has(rid)) {
                issues.push({
                    id: newId(),
                    severity: "warning",
                    message: `Pass "${pass.name}" writes unknown resource "${rid}"`,
                    location: pass.name,
                });
            }
        }

        // Steps referenced but missing
        for (const sid of pass.steps) {
            if (!pipeline.steps[sid]) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Pass "${pass.name}" references missing step "${sid}"`,
                    location: pass.name,
                });
            }
        }
    }

    // Passes in timeline but not in passes map
    for (const tl of pipeline.timelines) {
        for (const pid of tl.passIds) {
            if (!pipeline.passes[pid]) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Timeline "${tl.name}" references pass "${pid}" which does not exist`,
                    location: tl.name,
                });
            }
        }
    }

    // ── Step validation ──────────────────────────────────────────────────────
    const stepIds = new Set<string>();
    for (const [, step] of Object.entries(pipeline.steps)) {
        if (stepIds.has(step.id)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Duplicate step ID: "${step.id}"`,
                location: "Steps",
            });
        }
        stepIds.add(step.id);

        for (const rid of step.reads) {
            if (!allResourceIds.has(rid)) {
                issues.push({
                    id: newId(),
                    severity: "warning",
                    message: `Step "${step.name}" reads unknown resource "${rid}"`,
                    location: step.name,
                });
            }
        }
        for (const rid of step.writes) {
            if (!allResourceIds.has(rid)) {
                issues.push({
                    id: newId(),
                    severity: "warning",
                    message: `Step "${step.name}" writes unknown resource "${rid}"`,
                    location: step.name,
                });
            }
        }

        if (step.type === "raster") {
            const raster = step as RasterStep;
            // Validate color attachments
            for (const ca of raster.attachments.colorAttachments) {
                if (ca.target && !allResourceIds.has(ca.target)) {
                    issues.push({
                        id: newId(),
                        severity: "error",
                        message: `Step "${step.name}" color attachment references unknown target "${ca.target}"`,
                        location: step.name,
                    });
                }
                if (ca.blendState && !allResourceIds.has(ca.blendState)) {
                    issues.push({
                        id: newId(),
                        severity: "warning",
                        message: `Step "${step.name}" color attachment references unknown blend state "${ca.blendState}"`,
                        location: step.name,
                    });
                }
            }
            if (
                raster.attachments.depthAttachment?.target &&
                !allResourceIds.has(raster.attachments.depthAttachment.target)
            ) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Step "${step.name}" depth attachment references unknown target "${raster.attachments.depthAttachment.target}"`,
                    location: step.name,
                });
            }
            // Validate commands
            for (const cmd of raster.commands) {
                if (cmd.type === "drawBatch" && cmd.shader && !allResourceIds.has(cmd.shader)) {
                    issues.push({
                        id: newId(),
                        severity: "error",
                        message: `Command "${cmd.name}" in step "${step.name}" references unknown shader "${cmd.shader}"`,
                        location: step.name,
                    });
                }
                if (
                    cmd.type === "drawBatch" &&
                    cmd.blendState &&
                    !allResourceIds.has(cmd.blendState)
                ) {
                    issues.push({
                        id: newId(),
                        severity: "warning",
                        message: `Command "${cmd.name}" in step "${step.name}" references unknown blend state "${cmd.blendState}"`,
                        location: step.name,
                    });
                }
            }
        }

        if (step.type === "dispatchCompute" && step.shader && !allResourceIds.has(step.shader)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Step "${step.name}" references unknown shader "${step.shader}"`,
                location: step.name,
            });
        }
        if (
            step.type === "dispatchRayTracing" &&
            step.raygenShader &&
            !allResourceIds.has(step.raygenShader)
        ) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Step "${step.name}" references unknown raygen shader "${step.raygenShader}"`,
                location: step.name,
            });
        }
        if (
            step.type === "copyImage" ||
            step.type === "blitImage" ||
            step.type === "resolveImage"
        ) {
            if (step.source && !allResourceIds.has(step.source)) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Step "${step.name}" references unknown source "${step.source}"`,
                    location: step.name,
                });
            }
            if (step.destination && !allResourceIds.has(step.destination)) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Step "${step.name}" references unknown destination "${step.destination}"`,
                    location: step.name,
                });
            }
        }
        if (step.type === "generateMipChain" && step.target && !allResourceIds.has(step.target)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Step "${step.name}" references unknown target "${step.target}"`,
                location: step.name,
            });
        }
        if (step.type === "fillBuffer" && step.target && !allResourceIds.has(step.target)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Step "${step.name}" references unknown buffer "${step.target}"`,
                location: step.name,
            });
        }
    }

    // ── Duplicate resource IDs ───────────────────────────────────────────────
    const resIds = [
        ...resources.renderTargets.map((r) => r.id),
        ...resources.buffers.map((r) => r.id),
        ...resources.blendStates.map((r) => r.id),
        ...resources.shaders.map((r) => r.id),
        ...resources.inputParameters.map((r) => r.id),
    ];
    const seenRes = new Set<string>();
    for (const rid of resIds) {
        if (seenRes.has(rid)) {
            issues.push({
                id: newId(),
                severity: "error",
                message: `Duplicate resource ID: "${rid}"`,
                location: "Resources",
            });
        }
        seenRes.add(rid);
    }

    // ── Read-before-write check ─────────────────────────────────────────────
    // For each resource that is read by a pass, warn if no prior writer exists:
    //   • same-timeline writer at a lower index, OR
    //   • any cross-timeline writer (assumed to be semaphore-ordered before this pass)
    {
        const resourceNames = new Map<string, string>([
            ...resources.renderTargets.map((r) => [r.id, r.name] as [string, string]),
            ...resources.buffers.map((b) => [b.id, b.name] as [string, string]),
        ]);

        const passPos = new Map<string, { timelineId: string; idx: number }>();
        for (const tl of pipeline.timelines) {
            tl.passIds.forEach((pid, idx) => passPos.set(pid, { timelineId: tl.id, idx }));
        }

        const resReaders = new Map<
            string,
            Array<{ passId: string; timelineId: string; idx: number }>
        >();
        const resWriters = new Map<
            string,
            Array<{ passId: string; timelineId: string; idx: number }>
        >();

        for (const pass of Object.values(pipeline.passes)) {
            const pos = passPos.get(pass.id);
            if (!pos) continue;
            const { reads: r, writes: w } = inferPassResources(
                pass,
                pipeline.steps as Record<string, Step>,
            );
            for (const rid of r) {
                if (!resReaders.has(rid)) resReaders.set(rid, []);
                resReaders.get(rid)!.push({ passId: pass.id, ...pos });
            }
            for (const rid of w) {
                if (!resWriters.has(rid)) resWriters.set(rid, []);
                resWriters.get(rid)!.push({ passId: pass.id, ...pos });
            }
        }

        for (const [rid, readers] of resReaders) {
            const writers = resWriters.get(rid) ?? [];
            const resName = resourceNames.get(rid) ?? rid;
            for (const reader of readers) {
                const hasValidWriter = writers.some(
                    (w) => w.timelineId !== reader.timelineId || w.idx < reader.idx,
                );
                if (!hasValidWriter) {
                    const passName = pipeline.passes[reader.passId]?.name ?? reader.passId;
                    issues.push({
                        id: newId(),
                        severity: "warning",
                        message: `"${resName}" is read by "${passName}" but has no prior write on this timeline`,
                        location: passName,
                    });
                }
            }
        }
    }

    // ── Dependency cycle check ───────────────────────────────────────────────
    try {
        const edges = deriveDependencies(pipeline);
        // Simple cycle detection via DFS on same-timeline edges
        const adj = new Map<string, Set<string>>();
        for (const edge of edges) {
            if (!edge.isCrossTimeline) {
                if (!adj.has(edge.fromPassId)) adj.set(edge.fromPassId, new Set());
                adj.get(edge.fromPassId)!.add(edge.toPassId);
            }
        }
        const visited = new Set<string>();
        const inStack = new Set<string>();
        const hasCycle = (node: string): boolean => {
            visited.add(node);
            inStack.add(node);
            for (const neighbor of adj.get(node) ?? []) {
                if (!visited.has(neighbor) && hasCycle(neighbor)) return true;
                if (inStack.has(neighbor)) return true;
            }
            inStack.delete(node);
            return false;
        };
        for (const passId of Object.keys(pipeline.passes)) {
            if (!visited.has(passId) && hasCycle(passId)) {
                issues.push({
                    id: newId(),
                    severity: "error",
                    message: `Dependency cycle detected involving pass "${pipeline.passes[passId]?.name ?? passId}"`,
                    location: "Dependencies",
                });
                break;
            }
        }
    } catch {
        // ignore derivation errors in validation
    }

    return issues;
}
