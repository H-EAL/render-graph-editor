import type { Pipeline, PassId, ResourceId } from '../types';

export type AccessKind = 'read' | 'write' | 'readwrite';

export function derivePassAccess(
  resourceId: ResourceId,
  pipeline: Pipeline,
): Map<PassId, AccessKind> {
  const result = new Map<PassId, AccessKind>();
  for (const pass of Object.values(pipeline.passes)) {
    const writes = pass.writes.includes(resourceId);
    const reads  = pass.reads.includes(resourceId);
    if (writes && reads) result.set(pass.id, 'readwrite');
    else if (writes)     result.set(pass.id, 'write');
    else if (reads)      result.set(pass.id, 'read');
  }
  return result;
}
