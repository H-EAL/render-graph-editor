/**
 * System render targets injected by the engine into every per-view pipeline.
 * They are never stored in the document — they appear at authoring time only
 * so passes can reference them without validation errors.
 *
 * IDs match the engine-side constants:
 *   CANVAS_COLOR_INDEX   = UINT32_MAX - 16  (4294967279)
 *   CANVAS_PICKING_INDEX = UINT32_MAX - 17  (4294967278)
 *   CANVAS_NORMAL_INDEX  = UINT32_MAX - 18  (4294967277)
 *
 * Note: VIEW_RENDER_TARGET (UINT32_MAX - 19) is NOT a system resource — it is
 * an alias that redirects to whichever user-defined render target has been
 * designated as the default canvas blit target. It is tracked separately via
 * VIEW_RT_INDEX and is never injected into the resource library.
 */

import { useMemo } from "react";
import type { RenderTarget, ResourceLibrary } from "../types";
import { useStore } from "../state/store";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SYSTEM_RT_IDS = {
    CANVAS_COLOR:   "4294967279",
    CANVAS_PICKING: "4294967278",
    CANVAS_NORMAL:  "4294967277",
} as const;

export type SystemRtId = (typeof SYSTEM_RT_IDS)[keyof typeof SYSTEM_RT_IDS];

/**
 * The VIEW_RENDER_TARGET index (UINT32_MAX - 19) is a redirect to whichever
 * user-defined RT has been designated as the default canvas blit target.
 * It is NOT an actual system resource (no fixed format/size), but it must be
 * selectable in RT comboboxes so passes can reference it.
 */
export const VIEW_RT_INDEX = "4294967276";

export const VIEW_RT_PLACEHOLDER: RenderTarget = {
    id:          VIEW_RT_INDEX,
    name:        "view.renderTarget",
    format:      "rgba8",
    width:       "view.width",
    height:      "view.height",
    mips:        1,
    layers:      1,
    description: "Alias for the user-designated view render target (VIEW_RENDER_TARGET = UINT32_MAX-19)",
};

export const SYSTEM_RENDER_TARGETS: readonly RenderTarget[] = [
    {
        id:     SYSTEM_RT_IDS.CANVAS_COLOR,
        name:   "canvas.color",
        format: "rgba8",
        width:  "view.width",
        height: "view.height",
        mips:   1,
        layers: 1,
        description: "System canvas color buffer (CANVAS_COLOR_INDEX = UINT32_MAX-16)",
    },
    {
        id:     SYSTEM_RT_IDS.CANVAS_PICKING,
        name:   "canvas.picking",
        format: "r32f",
        width:  "view.width",
        height: "view.height",
        mips:   1,
        layers: 1,
        description: "System canvas picking buffer (CANVAS_PICKING_INDEX = UINT32_MAX-17)",
    },
    {
        id:     SYSTEM_RT_IDS.CANVAS_NORMAL,
        name:   "canvas.normal",
        format: "rg16f",
        width:  "view.width",
        height: "view.height",
        mips:   1,
        layers: 1,
        description: "System canvas normal buffer (CANVAS_NORMAL_INDEX = UINT32_MAX-18)",
    },
];

const SYSTEM_RT_ID_SET = new Set<string>(Object.values(SYSTEM_RT_IDS));

export function isSystemResource(id: string): boolean {
    return SYSTEM_RT_ID_SET.has(id);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the resource library augmented with system render targets.
 * System RTs are prepended to `renderTargets` only when the active pipeline
 * is the per-view pipeline (index 1).
 */
export function useEffectiveResources(): ResourceLibrary {
    const resources           = useStore((s) => s.resources);
    const activePipelineIndex = useStore((s) => s.activePipelineIndex);
    const isPerView           = activePipelineIndex === 1;

    return useMemo(() => {
        if (!isPerView) return resources;
        return {
            ...resources,
            renderTargets: [...SYSTEM_RENDER_TARGETS, VIEW_RT_PLACEHOLDER, ...resources.renderTargets],
        };
    }, [resources, isPerView]);
}
