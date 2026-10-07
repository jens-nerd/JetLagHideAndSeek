/**
 * Prüft, dass `leaveSession()` wirklich jeden sitzungsgebundenen Store
 * zurücksetzt. Übrig gebliebene Mitspieler, Seeker-Positionen oder
 * Benachrichtigungs-Reste tauchen sonst in der nächsten Session wieder auf –
 * mit IDs, die dort nicht mehr existieren.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/maps/api/cache", () => ({ clearCache: vi.fn() }));

import {
    autoExpandQuestionId,
    leaveSession,
    newQuestionReceived,
    recentlyAnswered,
    seekerPositions,
    sessionMembers,
    sessionParticipant,
} from "../session-context";

describe("leaveSession", () => {
    beforeEach(() => {
        sessionParticipant.set({
            id: "p1",
            role: "hider",
            displayName: "Testperson",
            token: "t1",
        } as never);
        sessionMembers.set([
            { id: "p1", role: "hider", displayName: "Testperson" },
            { id: "p2", role: "seeker", displayName: "Andere" },
        ]);
        seekerPositions.set([{ id: "p2", lat: 53.5, lng: 10.0, displayName: "Andere" } as never]);
        recentlyAnswered.set({ id: "q1", positive: true });
        newQuestionReceived.set({ id: "q2", type: "radius" });
        autoExpandQuestionId.set("q1");
    });

    it("leert die Mitspielerliste", () => {
        leaveSession();
        expect(sessionMembers.get()).toEqual([]);
    });

    it("entfernt die Seeker-Positionen, damit keine fremden Pins übrig bleiben", () => {
        leaveSession();
        expect(seekerPositions.get()).toEqual([]);
    });

    it("verwirft offene Benachrichtigungen der alten Session", () => {
        leaveSession();
        expect(recentlyAnswered.get()).toBeNull();
        expect(newQuestionReceived.get()).toBeNull();
        expect(autoExpandQuestionId.get()).toBeNull();
    });
});
