/**
 * 3dverse Shader Descriptor API
 *
 * Endpoint: GET https://api.3dverse.com/app/v1/assets/shaders/{uuid}/description
 * Header:   api_key: <your_key>
 *
 * The response schema is not publicly documented in detail, so we map it from
 * runtime data and from the naming conventions used in dataJson inside rg.json:
 *   - slot names ending in `_inout_rt`  → access = 'read_write'
 *   - slot names ending in `_output_rt` or `_out_rt` → access = 'write'
 *   - all other RT slots               → access = 'read'
 */

import { useEffect, useState } from "react";

export type SlotAccess = "read" | "write" | "read_write";

export interface ShaderRTSlot {
    name: string;
    access: SlotAccess;
    isSizeRef?: boolean;
}

export interface ShaderDescriptor {
    uuid: string;
    name: string;
    renderTargetSlots: ShaderRTSlot[];
}

// ─── localStorage API key ─────────────────────────────────────────────────────

const API_KEY_STORAGE = "3dv_api_key";

export function getApiKey(): string {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
}

export function setApiKey(key: string): void {
    localStorage.setItem(API_KEY_STORAGE, key);
    // Bust the in-memory cache so re-fetches pick up the new key
    descriptorCache.clear();
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const descriptorCache = new Map<string, ShaderDescriptor>();

// Infer slot access from its name
export function inferAccess(name: string): SlotAccess {
    const lower = name.toLowerCase();
    // Explicit read+write patterns
    if (lower.includes("inout") || lower.includes("_rw_") || lower.endsWith("_rw"))
        return "read_write";
    // history / accumulation buffers are typically read+write
    if (lower.startsWith("history_") || lower.includes("_history_") || lower.includes("accumul"))
        return "read_write";
    // Write / output patterns
    if (
        lower.includes("output") ||
        lower.includes("_out_") ||
        lower.startsWith("out_") ||
        lower.includes("result_") ||
        lower.startsWith("result") ||
        lower.includes("_result")
    )
        return "write";
    return "read";
}

// Normalise the raw API response into our typed descriptor.
// The actual API may return different keys — adjust here once the real schema
// is known.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseApiResponse(uuid: string, data: any): ShaderDescriptor {
    const name: string = data?.name ?? data?.label ?? uuid;

    // Try to extract RT slots from known possible response shapes.
    const slots: ShaderRTSlot[] = [];

    // Shape 1: data.renderTargetSlots = [{name, access}, ...]
    if (Array.isArray(data?.renderTargetSlots)) {
        for (const s of data.renderTargetSlots) {
            slots.push({
                name: String(s.name),
                access: (s.access as SlotAccess) ?? inferAccess(s.name),
            });
        }
    }

    // Shape 2: data.parameters = [{name, type, ...}, ...]
    if (slots.length === 0 && Array.isArray(data?.parameters)) {
        for (const p of data.parameters) {
            if (
                typeof p.name === "string" &&
                (String(p.type ?? "")
                    .toLowerCase()
                    .includes("render") ||
                    String(p.name).toLowerCase().includes("_rt"))
            ) {
                slots.push({ name: p.name, access: inferAccess(p.name) });
            }
        }
    }

    // Shape 3: data.inputs / data.outputs as name arrays
    if (slots.length === 0) {
        if (Array.isArray(data?.inputs)) {
            for (const n of data.inputs) slots.push({ name: String(n), access: "read" });
        }
        if (Array.isArray(data?.outputs)) {
            for (const n of data.outputs) slots.push({ name: String(n), access: "write" });
        }
    }

    return { uuid, name, renderTargetSlots: slots };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchShaderDescriptor(uuid: string): Promise<ShaderDescriptor> {
    if (descriptorCache.has(uuid)) return descriptorCache.get(uuid)!;

    const apiKey = getApiKey();
    if (!apiKey) throw new Error("No 3dverse API key configured");

    const url = `https://api.3dverse.com/app/v1/assets/shaders/${uuid}/description`;
    const res = await fetch(url, { headers: { api_key: apiKey } });

    if (!res.ok) {
        throw new Error(`Shader API returned ${res.status} for ${uuid}`);
    }

    const data = await res.json();
    const descriptor = parseApiResponse(uuid, data);
    descriptorCache.set(uuid, descriptor);
    return descriptor;
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseShaderDescriptorResult {
    descriptor: ShaderDescriptor | null;
    loading: boolean;
    error: string | null;
}

export function useShaderDescriptor(uuid: string | undefined): UseShaderDescriptorResult {
    const [descriptor, setDescriptor] = useState<ShaderDescriptor | null>(() =>
        uuid ? (descriptorCache.get(uuid) ?? null) : null,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!uuid) {
            setDescriptor(null);
            setLoading(false);
            setError(null);
            return;
        }

        if (descriptorCache.has(uuid)) {
            setDescriptor(descriptorCache.get(uuid)!);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchShaderDescriptor(uuid)
            .then((d) => {
                if (!cancelled) {
                    setDescriptor(d);
                    setLoading(false);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [uuid]);

    return { descriptor, loading, error };
}
