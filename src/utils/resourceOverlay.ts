import type { Pipeline, PassId, ResourceId, Step } from "../types";
import { inferPassResources } from "./inferStepResources";

export type AccessKind = "read" | "write" | "readwrite" | "color" | "depth" | "resolve" | "colorread" | "depthread";

export function derivePassAccess(
    resourceId: ResourceId,
    pipeline: Pipeline,
): Map<PassId, AccessKind> {
    const result = new Map<PassId, AccessKind>();
    for (const pass of Object.values(pipeline.passes)) {
        const { reads: r, writes: w } = inferPassResources(
            pass,
            pipeline.steps as Record<string, Step>,
        );
        const writes = w.includes(resourceId);
        const reads = r.includes(resourceId);
        if (writes && reads) result.set(pass.id, "readwrite");
        else if (writes) result.set(pass.id, "write");
        else if (reads) result.set(pass.id, "read");
    }
    return result;
}
