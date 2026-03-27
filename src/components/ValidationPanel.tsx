import { useMemo } from 'react';
import { useStore } from '../state/store';
import { validateDocument } from '../validation';

export function ValidationPanel() {
  const { pipeline, resources, inputDefinitions } = useStore();
  const globalPipeline = useStore((s) => s.pipelines[0]?.pipeline);
  const globalWrittenIds = useMemo(() => {
    if (!globalPipeline) return undefined;
    const ids = new Set<string>();
    for (const pass of Object.values(globalPipeline.passes)) {
      pass.writes.forEach((id) => ids.add(id));
    }
    for (const step of Object.values(globalPipeline.steps)) {
      (step.writes ?? []).forEach((id) => ids.add(id));
    }
    return ids;
  }, [globalPipeline]);
  const issues = useMemo(() => validateDocument(pipeline, resources, inputDefinitions, globalWrittenIds), [pipeline, resources, inputDefinitions, globalWrittenIds]);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-emerald-400 text-sm">
        <span className="text-lg">✓</span>
        <span>No validation issues found.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      <div className="flex items-center gap-4 px-3 py-2 border-b border-zinc-700/40">
        {errors.length > 0 && (
          <span className="text-xs text-red-400">{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
        )}
        {warnings.length > 0 && (
          <span className="text-xs text-amber-400">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="overflow-y-auto">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/60 text-xs ${
              issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'
            }`}
          >
            <span className="shrink-0 mt-0.5">{issue.severity === 'error' ? '✗' : '⚠'}</span>
            <div className="flex flex-col gap-0.5">
              <span>{issue.message}</span>
              {issue.location && (
                <span className="text-zinc-500">in {issue.location}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
