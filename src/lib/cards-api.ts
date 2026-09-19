/**
 * Aufrufe der Kartenendpunkte.
 * Fehler kommen als ApiError mit der Kennung aus dem Antwortkörper zurück,
 * damit die Oberfläche `cards_disabled` und `hand_limit` unterscheiden kann.
 */
import type { Fluch, HandKarte } from "@hideandseek/shared";

import { apiFetch } from "./session-api";

export interface ZiehAntwort {
    angeboten: HandKarte[];
    behalten: number;
    deckRest: number;
    /** true, wenn dieser Zug eine Karte mehr aufgedeckt hat als sonst. */
    nachschlagAktiv: boolean;
    /** Restanwendungen nach diesem Zug; null, wenn keiner mehr laeuft. */
    nachschlagRest: number | null;
}

export interface HandAntwort {
    hand: HandKarte[];
    deckRest: number;
}

export function ziehen(
    questionId: string,
    token: string,
): Promise<ZiehAntwort> {
    return apiFetch(`/api/questions/${questionId}/draw`, {
        method: "POST",
        token,
    });
}

export function behalten(
    questionId: string,
    token: string,
    body: { behalten: string[]; abwerfen?: string[] },
): Promise<HandAntwort> {
    return apiFetch(`/api/questions/${questionId}/keep`, {
        method: "POST",
        token,
        body: JSON.stringify(body),
    });
}

export function fluchSpielen(
    code: string,
    token: string,
    deckCardId: string,
): Promise<{ curse: Fluch }> {
    return apiFetch(`/api/sessions/${code}/curses`, {
        method: "POST",
        token,
        body: JSON.stringify({ deckCardId }),
    });
}

export function fluchBeenden(
    curseId: string,
    token: string,
): Promise<{ curse: Fluch }> {
    return apiFetch(`/api/curses/${curseId}/end`, {
        method: "POST",
        token,
    });
}

export function kartenmechanikSchalten(
    code: string,
    token: string,
    cardsEnabled: boolean,
): Promise<{ cardsEnabled: boolean }> {
    return apiFetch(`/api/sessions/${code}/cards`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ cardsEnabled }),
    });
}
