/**
 * Syncs session questions into the local questions atom so that
 * the existing Leaflet map renders them automatically.
 *
 * - SEEKER / HIDER answered: answered questions are inserted with their
 *   `answerData` so the map shows the final clipped result.
 * - Pending questions are NOT inserted into the questions atom – doing so
 *   would corrupt the map clipping pipeline (applyQuestionsToMapGeoData runs
 *   them through adjustMapGeoDataForQuestion even when drag=true because the
 *   skip condition only fires when planningModeEnabled=true).  The visual
 *   outlines for pending questions (radius circles etc.) are rendered directly
 *   by DraggableMarkers via react-leaflet geometry components instead.
 *
 * Mount this hook once in a top-level component (e.g. QuestionSidebar.tsx).
 */
import { useStore } from "@nanostores/react";
import { useEffect } from "react";

import {
    isLoading,
    mapGeoJSON,
    questions as localQuestions,
} from "@/lib/context";
import { pendingDraftKey, sessionParticipant, sessionQuestions } from "@/lib/session-context";
import { questionsSchema } from "@/maps/schema";

/**
 * Derive a stable numeric key from a nanoid string so the same session
 * question always maps to the same local Question key.  A simple djb2-style
 * hash is sufficient – collisions across the small number of questions in a
 * single session are extremely unlikely.
 */
function stableNumericKey(id: string, salt = 0): number {
    let h = 5381 ^ salt;
    for (let i = 0; i < id.length; i++) {
        h = (Math.imul(h, 33) ^ id.charCodeAt(i)) >>> 0;
    }
    // Keep it positive and in float-safe integer range
    return h;
}

export function useSessionMapSync() {
    const participant = useStore(sessionParticipant);
    const sqList = useStore(sessionQuestions);

    useEffect(() => {
        if (!participant) return;

        // ── 1. Answered questions → insert with answerData (all roles) ────────
        const answeredSq = sqList.filter(
            (sq) => sq.status === "answered" && sq.answerData,
        );

        const parsedAnswered = answeredSq.flatMap((sq) => {
            try {
                const stableKey = stableNumericKey(sq.id, 0);
                // Merge original question data (lat, lng, radius, locationType, …)
                // with the computed answer fields (within, location, warmer, …),
                // and force drag=false so the map clips instead of showing a
                // draggable outline.
                //
                // Using sq.data as the base is important: it contains all required
                // schema fields (lat, lng, color, etc.) that the seeker set when
                // creating the question, guaranteeing Zod validation passes even if
                // answerData only carries a subset of those fields.
                const answeredData =
                    typeof sq.data === "object" && sq.data !== null &&
                    typeof sq.answerData === "object" && sq.answerData !== null
                        ? { ...(sq.data as object), ...(sq.answerData as object), drag: false }
                        : sq.answerData;
                const raw = { id: sq.type, key: stableKey, data: answeredData };
                const result = questionsSchema.safeParse([raw]);
                if (result.success) {
                    return result.data;
                }
                console.warn(
                    "[SessionMapSync] Zod validation failed for question",
                    sq.id, sq.type,
                    result.error.format(),
                );
                return [];
            } catch (e) {
                console.warn("[SessionMapSync] Exception for question", sq.id, e);
                return [];
            }
        });

        // ── 2. Use only session questions while a session is active ──────────
        // Local (user-added) questions are excluded when in a session so they
        // don't mix with the session's answered questions and produce a
        // different map than the other player sees.  Pending questions are also
        // NOT merged — they are rendered as visual outlines directly by
        // DraggableMarkers (react-leaflet Circle etc.) so the map clipping
        // pipeline is never fed incomplete/default question data.
        const merged = [...parsedAnswered];

        // ── 3. Preserve the seeker's pending draft question ───────────────────
        // When the mobile sidebar Sheet closes, QuestionSidebar (and this hook)
        // unmount. On reopen they remount and this effect runs again. Without
        // this guard, `localQuestions.set(merged)` would wipe the draft question
        // that was staged in questions_atom before the sidebar was closed.
        // We re-include the draft question in finalMerged so it survives the
        // sidebar close/reopen cycle. Once it is sent (pendingDraftKey → null)
        // the answered version from parsedAnswered takes its place naturally.
        const draftKey = pendingDraftKey.get();
        const draftQuestion =
            draftKey !== null
                ? localQuestions.get().find((q) => q.key === draftKey) ?? null
                : null;
        const finalMerged = draftQuestion ? [draftQuestion, ...merged] : merged;

        // Apply the merged questions once any in-flight refreshQuestions() has
        // finished.  Map.tsx reads `$isLoading` from the React render closure,
        // so if we set atoms while isLoading=true the resulting useEffect fires
        // but immediately returns (race condition → blank/blue map).
        //
        // By waiting for isLoading=false we guarantee that the next
        // localQuestions.set() triggers a refreshQuestions() that actually runs.
        // mapGeoJSON is reset to null so refreshQuestions() starts from the raw
        // polyGeoJSON base instead of the previously-clipped cached result.
        const applyMerged = () => {
            // If there are no answered session questions to sync and the local
            // questions atom is already empty, skip the update entirely.
            // Setting localQuestions to a new [] reference (even when it was
            // already []) would trigger Map's useEffect → a redundant second
            // Overpass fetch cycle with no benefit.
            if (finalMerged.length === 0 && localQuestions.get().length === 0) return;

            if (isLoading.get()) {
                // Another refreshQuestions() is in flight — subscribe and apply
                // as soon as it finishes.
                const unsub = isLoading.subscribe((loading) => {
                    if (!loading) {
                        unsub();
                        mapGeoJSON.set(null);
                        localQuestions.set(finalMerged);
                    }
                });
            } else {
                mapGeoJSON.set(null);
                localQuestions.set(finalMerged);
            }
        };
        applyMerged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sqList, participant]);
}
