/**
 * Automatically pushes the hider's mapGeoLocation changes to the backend
 * via REST (PATCH /api/sessions/:code/map) whenever the atom changes.
 *
 * Only active when the current participant is the hider.
 * Mount once inside a component that is always rendered during a session
 * (e.g. QuestionSidebar).
 */
import { useStore } from "@nanostores/react";
import { useEffect, useRef } from "react";

import { mapGeoLocation } from "@/lib/context";
import { updateMapLocation } from "@/lib/session-api";
import {
    buildMapLocationFromContext,
    sessionCode,
    sessionParticipant,
} from "@/lib/session-context";

export function useMapLocationSync() {
    const participant = useStore(sessionParticipant);
    const code = useStore(sessionCode);
    // Track whether this is the first render so we don't push on mount
    const isFirstRender = useRef(true);

    useEffect(() => {
        // Only the hider needs to push map changes
        if (!participant || participant.role !== "hider" || !code) return;

        // Subscribe to mapGeoLocation changes
        const unsubscribe = mapGeoLocation.subscribe(async (_feature) => {
            // Skip the initial subscription call
            if (isFirstRender.current) {
                isFirstRender.current = false;
                return;
            }

            const mapLocationPayload = buildMapLocationFromContext();
            if (!mapLocationPayload) return;

            try {
                await updateMapLocation(code, participant.token, {
                    mapLocation: mapLocationPayload,
                });
            } catch {
                // Non-critical: if the push fails the seeker will still get
                // the location on the next WS sync or page reload.
            }
        });

        return () => {
            unsubscribe();
            // Reset so next mount skips the initial call again
            isFirstRender.current = true;
        };
    }, [participant, code]);
}
