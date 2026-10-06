/**
 * Aufrufe der Kartenendpunkte.
 * Fehler kommen als ApiError mit der Kennung aus dem Antwortkörper zurück,
 * damit die Oberfläche `cards_disabled` und `hand_limit` unterscheiden kann.
 */
import type { Fluch, HandKarte, Nachweis, Nachweisart } from "@hideandseek/shared";

import { apiFetch, bildHochladen } from "./session-api";

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

/**
 * Haengt Nachweise an einen Fluch. Nimmt ein Array und gibt die ganze Liste
 * des Fluchs zurueck, nicht nur den Zuwachs.
 *
 * `von` und `am` setzt der Server aus Token und Serverzeit; mitgeschickte
 * Werte ignoriert er.
 */
export function nachweiseAnhaengen(
    curseId: string,
    token: string,
    nachweise: { url: string; art: Nachweisart }[],
): Promise<{ nachweise: Nachweis[] }> {
    return apiFetch(`/api/curses/${curseId}/nachweise`, {
        method: "POST",
        token,
        body: JSON.stringify({ nachweise }),
    });
}

/**
 * Der zweistufige Weg: jede Datei einzeln nach `/api/upload`, dann **ein**
 * Aufruf von `nachweiseAnhaengen` mit allen Adressen.
 *
 * Ein Aufruf statt einer je Datei ist Pflicht, nicht Bequemlichkeit: der
 * Endpunkt liest, haengt an und schreibt zurueck. Flo hat belegt, dass von
 * fuenf gleichzeitigen Einzelaufrufen ohne Transaktion nur einer uebrig
 * bleibt; mit einem Aufruf ist die Frage gar nicht gestellt.
 */
export async function nachweiseHochladen(
    curseId: string,
    token: string,
    dateien: File[],
): Promise<Nachweis[]> {
    const neue: { url: string; art: Nachweisart }[] = [];
    for (const datei of dateien) {
        const { url } = await bildHochladen(datei, token);
        neue.push({ url, art: "bild" });
    }
    const { nachweise } = await nachweiseAnhaengen(curseId, token, neue);
    return nachweise;
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
