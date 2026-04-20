/**
 * Overpass API proxy route.
 *
 * Accepts a JSON body `{ query: string }`, checks an in-memory cache, and
 * forwards the query to public Overpass endpoints via POST with automatic
 * fallback and retry on 429/503.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";

// ── Overpass endpoints (tried in order) ─────────────────────────────────────

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];

const TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_DELAY_MS = 3_000;
const RETRYABLE_STATUSES = new Set([429, 503, 504]);

// ── In-memory cache ─────────────────────────────────────────────────────────

interface CacheEntry {
    data: unknown;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(query: string): string {
    return createHash("sha256").update(query).digest("hex");
}

/** Remove expired entries (lazy cleanup). */
function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

// overpass-api.de's Apache returns 406 Not Acceptable to Node's default
// `User-Agent: node` — set an explicit UA so the primary endpoint accepts
// our POSTs. Overpass asks clients to identify themselves:
// https://wiki.openstreetmap.org/wiki/Overpass_API#User-Agent
const USER_AGENT =
    "JetLagHideAndSeek/0.0.1 (+https://github.com/jens-nerd/JetLagHideAndSeek)";

async function fetchWithTimeout(
    endpoint: string,
    query: string,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function tryEndpoint(
    endpoint: string,
    query: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    try {
        const resp = await fetchWithTimeout(endpoint, query, TIMEOUT_MS);

        // Retry once on 429 / 503
        if (RETRYABLE_STATUSES.has(resp.status)) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            const retry = await fetchWithTimeout(endpoint, query, TIMEOUT_MS);
            if (!retry.ok) {
                return { ok: false, error: `HTTP ${retry.status} (retry) from ${endpoint}` };
            }
            return { ok: true, data: await retry.json() };
        }

        if (!resp.ok) {
            return { ok: false, error: `HTTP ${resp.status} from ${endpoint}` };
        }

        return { ok: true, data: await resp.json() };
    } catch (err: any) {
        return { ok: false, error: `${endpoint}: ${err?.message ?? err}` };
    }
}

// ── Route ───────────────────────────────────────────────────────────────────

export function createOverpassRouter(): Hono {
    const router = new Hono();

    router.post("/overpass", async (c) => {
        const body = await c.req.json<{ query?: string }>().catch(() => null);
        const query = body?.query?.trim();

        if (!query) {
            return c.json({ error: "Missing 'query' in request body" }, 400);
        }

        // ── Cache check ─────────────────────────────────────────────────
        evictExpired();
        const key = cacheKey(query);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return c.json(cached.data);
        }

        // ── Forward to Overpass ─────────────────────────────────────────
        const errors: string[] = [];

        for (const endpoint of OVERPASS_ENDPOINTS) {
            const result = await tryEndpoint(endpoint, query);
            if (result.ok) {
                cache.set(key, {
                    data: result.data,
                    expiresAt: Date.now() + CACHE_TTL_MS,
                });
                return c.json(result.data);
            }
            errors.push(result.error);
            console.warn(`[overpass-proxy] ${result.error}`);
        }

        return c.json(
            { error: "All Overpass endpoints failed", details: errors },
            502,
        );
    });

    return router;
}
