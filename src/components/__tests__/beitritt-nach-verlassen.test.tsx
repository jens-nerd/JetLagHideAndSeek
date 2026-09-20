/**
 * Prüft den Beitritts-Flow im CreateSessionOverlay über einen zweiten Join
 * hinweg: Das Overlay wird beim Verlassen der Session nicht ausgehängt,
 * sondern rendert nur `null`, solange `sessionParticipant` gesetzt ist. Der
 * React-State (u. a. `loading`) muss trotzdem nach einem erfolgreichen Join
 * wieder auf einen sauberen Ausgangszustand zurückfallen, sonst schluckt der
 * nächste Rollen-Klick jede Anfrage.
 *
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom } from "nanostores";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19 warnt sonst bei jedem act(), weil vitest keine eigene
// DOM-Testumgebungs-Markierung setzt.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const joinSession = vi.fn();
const getSession = vi.fn();
const createSession = vi.fn();

vi.mock("@/lib/session-api", () => ({ joinSession, getSession, createSession }));

const sessionParticipant = atom<any>(null);
const sessionCode = atom<string | null>(null);
const hiderAreaConfirmed = atom(false);
const gameSize = atom<"S" | "M" | "L" | null>(null);

vi.mock("@/lib/session-context", () => ({
    sessionParticipant,
    sessionCode,
    hiderAreaConfirmed,
    gameSize,
    applyServerMapLocation: vi.fn(),
    buildMapLocationFromContext: vi.fn(() => undefined),
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

// Zieht Leaflet/PlacePicker nicht mit rein; wird im Join-Flow ohnehin nicht
// gerendert.
vi.mock("../session/HiderAreaSearch", () => ({ HiderAreaSearch: () => null }));

let container: HTMLDivElement;
let root: Root;

async function flush() {
    // Lässt die await-Kette in handleSelectRole (joinSession → getSession)
    // durchlaufen, bevor der nächste Schritt in der Assertion stattfindet.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function click(el: Element | null) {
    if (!el) throw new Error("Element nicht gefunden");
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function type(input: Element | null, value: string) {
    if (!input) throw new Error("Input nicht gefunden");
    const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
    )!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function buttonByText(text: string): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes(text),
    ) ?? null;
}

/** Navigiert von "entry" bis zum "rolle"-Schritt im Beitritts-Flow. */
async function gotoRolle(code: string) {
    type(container.querySelector('input[placeholder="overlay.namePlaceholder"]'), "Testperson");
    click(buttonByText("overlay.joinGame"));

    type(container.querySelector('input[placeholder="overlay.joinCodePlaceholder"]'), code);
    click(buttonByText("overlay.next"));
}

describe("CreateSessionOverlay – Beitritt nach Verlassen der Session", () => {
    beforeEach(async () => {
        sessionParticipant.set(null);
        sessionCode.set(null);
        hiderAreaConfirmed.set(false);
        gameSize.set(null);
        joinSession.mockReset();
        getSession.mockReset();

        container = document.createElement("div");
        document.body.appendChild(container);

        const { CreateSessionOverlay } = await import("../session/CreateSessionOverlay");
        root = createRoot(container);
        act(() => {
            root.render(<CreateSessionOverlay />);
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.resetModules();
    });

    it("stellt nach dem Verlassen der Session einen zweiten joinSession-Aufruf zu", async () => {
        joinSession.mockResolvedValue({
            session: { code: "ABCDEF" },
            participant: { role: "seeker", token: "t1" },
        });
        getSession.mockResolvedValue({ session: {} });

        await gotoRolle("ABCDEF");
        click(buttonByText("overlay.roleName.seeker"));
        await flush();

        expect(joinSession).toHaveBeenCalledTimes(1);

        // Session verlassen: der Store wird zurückgesetzt, die Komponente
        // wird dabei NICHT ausgehängt (sie rendert nur `null`, solange
        // sessionParticipant gesetzt ist) – ihr React-State überlebt also,
        // inklusive step="rolle": das Overlay taucht direkt dort wieder auf.
        act(() => {
            sessionParticipant.set(null);
        });

        // Zweiter Versuch, dieselbe Rolle erneut zu wählen.
        joinSession.mockResolvedValue({
            session: { code: "ABCDEF" },
            participant: { role: "seeker", token: "t2" },
        });
        click(buttonByText("overlay.roleName.seeker"));
        await flush();

        expect(joinSession).toHaveBeenCalledTimes(2);
        expect(joinSession).toHaveBeenLastCalledWith("ABCDEF", {
            displayName: "Testperson",
            role: "seeker",
        });
    });

    it("löscht einen alten Fehlertext, sobald danach erfolgreich beigetreten und die Session verlassen wird", async () => {
        joinSession.mockRejectedValueOnce(new Error("Session not found"));

        await gotoRolle("ZZZZZZ");
        click(buttonByText("overlay.roleName.seeker"));
        await flush();

        expect(container.textContent).toContain("Session not found");

        joinSession.mockResolvedValueOnce({
            session: { code: "ZZZZZZ" },
            participant: { role: "seeker", token: "t1" },
        });
        getSession.mockResolvedValue({ session: {} });
        click(buttonByText("overlay.roleName.seeker"));
        await flush();

        act(() => {
            sessionParticipant.set(null);
        });

        expect(container.textContent).not.toContain("Session not found");
    });
});
