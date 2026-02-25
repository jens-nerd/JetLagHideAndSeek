/**
 * Nanostores atoms for the multiplayer session state.
 * These live alongside the existing context.ts atoms.
 */
import { persistentAtom } from "@nanostores/persistent";
import type {
    MapLocation,
    ParticipantWithToken,
    Role,
    Session,
    SessionQuestion,
} from "@hideandseek/shared";
import { atom } from "nanostores";

// ── Persisted (survive page reload) ──────────────────────────────────────────

/** The participant's own token + metadata, stored in localStorage */
export const sessionParticipant = persistentAtom<ParticipantWithToken | null>(
    "session_participant",
    null,
    { encode: JSON.stringify, decode: JSON.parse },
);

/** Session code the user is currently in */
export const sessionCode = persistentAtom<string | null>(
    "session_code",
    null,
    { encode: JSON.stringify, decode: JSON.parse },
);

// ── In-memory ─────────────────────────────────────────────────────────────────

/** Full session object (refreshed from server or synced via WS) */
export const currentSession = atom<Session | null>(null);

/**
 * Role chosen in the onboarding screen before a session is created/joined.
 * Cleared when the session starts or the user navigates back to role selection.
 */
export const pendingRole = atom<"hider" | "seeker" | null>(null);

/** All questions in the current session */
export const sessionQuestions = atom<SessionQuestion[]>([]);

/** Connection status of the WebSocket */
export const wsStatus = atom<"disconnected" | "connecting" | "connected">(
    "disconnected",
);

/** Number of seekers connected to the session (from WS sync) */
export const seekerCount = atom<number>(0);

/** Whether the hider is connected */
export const hiderConnected = atom<boolean>(false);

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getRole(): Role | null {
    return sessionParticipant.get()?.role ?? null;
}

export function getToken(): string | null {
    return sessionParticipant.get()?.token ?? null;
}

export function isInSession(): boolean {
    return sessionCode.get() !== null && sessionParticipant.get() !== null;
}

export function leaveSession(): void {
    // ── Session state ──────────────────────────────────────────────────────
    sessionParticipant.set(null);
    sessionCode.set(null);
    currentSession.set(null);
    sessionQuestions.set([]);
    wsStatus.set("disconnected");
    seekerCount.set(0);
    hiderConnected.set(false);
    pendingRole.set(null);

    // ── Map state – reset everything that was set by the session ──────────
    import("@/lib/context").then(
        ({ questions, mapGeoJSON, mapGeoLocation, hiderMode, questionModified }) => {
            // Remove all session questions from the local map
            questions.set([]);
            questionModified();

            // Clear the computed map overlay
            mapGeoJSON.set(null);

            // Deactivate hider GPS mode
            hiderMode.set(false);

            // Reset map to the default location (Japan).
            // The default value is duplicated here to keep session-context.ts
            // free of a static import from context.ts (avoids circular deps).
            mapGeoLocation.set({
                geometry: {
                    coordinates: [36.5748441, 139.2394179],
                    type: "Point",
                },
                type: "Feature",
                properties: {
                    osm_type: "R",
                    osm_id: 382313,
                    extent: [45.7112046, 122.7141754, 20.2145811, 154.205541],
                    country: "Japan",
                    osm_key: "place",
                    countrycode: "JP",
                    osm_value: "country",
                    name: "Japan",
                    type: "country",
                },
            } as any);
        },
    );
}

/** Upsert a question in the local list (add or update in place) */
export function upsertSessionQuestion(question: SessionQuestion): void {
    const current = sessionQuestions.get();
    const idx = current.findIndex((q) => q.id === question.id);
    if (idx === -1) {
        sessionQuestions.set([...current, question]);
    } else {
        const updated = [...current];
        updated[idx] = question;
        sessionQuestions.set(updated);
    }
}

/**
 * Apply a MapLocation received from the server into the local mapGeoLocation
 * atom so the map boundary updates immediately.
 */
export function applyServerMapLocation(location: MapLocation): void {
    // Dynamic import to avoid circular dependency with context.ts
    import("@/lib/context").then(({ mapGeoLocation }) => {
        // osmFeature is the full OpenStreetMap Feature the app uses natively.
        if (location.osmFeature) {
            mapGeoLocation.set(location.osmFeature as any);
        }
    });
}

/**
 * Read the current mapGeoLocation atom and build a MapLocation object
 * suitable for storing in the backend session.
 * The osmFeature field carries the full Feature so the seeker's map can
 * render the exact same boundary as the hider.
 */
export async function buildMapLocationFromContext(): Promise<MapLocation | null> {
    const { mapGeoLocation } = await import("@/lib/context");
    const feature = mapGeoLocation.get();
    if (!feature) return null;

    // OSM Feature coordinates are [lng, lat]
    const coords = (feature as any)?.geometry?.coordinates as
        | [number, number]
        | undefined;
    const lat = coords ? coords[1] : 0;
    const lng = coords ? coords[0] : 0;
    const name: string =
        (feature as any)?.properties?.name ??
        (feature as any)?.properties?.display_name ??
        "";

    return { lat, lng, name, osmFeature: feature };
}
