/**
 * overpassFetch — sends Overpass queries through our own backend proxy.
 *
 * The backend handles endpoint fallback, retry, and server-side caching.
 * This keeps the frontend simple: one POST to our own server.
 */

const BACKEND_URL =
    import.meta.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export interface OverpassFetchOptions {
    /** Per-request timeout in milliseconds (default: 60 000). */
    timeoutMs?: number;
    /** An external AbortSignal — if aborted, the request stops immediately. */
    signal?: AbortSignal;
}

/**
 * Fetch an Overpass query via the backend proxy.
 *
 * @param query  The raw Overpass QL query string (NOT URL-encoded).
 * @param opts   Optional timeout and abort signal.
 * @returns      Parsed JSON response from Overpass.
 * @throws       If the proxy returns an error or the request times out.
 */
export async function overpassFetch(
    query: string,
    opts: OverpassFetchOptions = {},
): Promise<any> {
    const { timeoutMs = 60_000, signal: externalSignal } = opts;

    const controller = new AbortController();

    // Link external signal → internal abort
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

    // Timeout
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(`${BACKEND_URL}/api/overpass`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(
                body?.error ?? `Overpass proxy returned HTTP ${resp.status}`,
            );
        }

        return await resp.json();
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);
    }
}
