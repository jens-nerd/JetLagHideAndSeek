/**
 * Kartenmechanik im Frontend.
 *
 * Nichts davon liegt im localStorage: Der Server ist die Wahrheit, und das
 * sync-Ereignis beim Verbinden stellt den Zustand wieder her. Ein Neuladen
 * mitten im Spiel verliert also nichts.
 */
import type { Fluch, Fragekategorie, HandKarte, PendingDraw } from "@hideandseek/shared";
import { GLUECKSRAD_ID } from "@hideandseek/shared";
import { atom } from "nanostores";

/** Kartenmechanik in dieser Sitzung eingeschaltet. */
export const cardsEnabled = atom<boolean>(false);

/** Hand des Versteckenden. Bei Suchenden immer leer. */
export const hand = atom<HandKarte[]>([]);

/** Verbleibende Karten im Deck. */
export const deckRest = atom<number>(0);

/** Offener Ziehvorgang, falls der Versteckende gezogen, aber nicht behalten hat. */
export const pendingDraw = atom<PendingDraw | null>(null);

/**
 * Nachschlag im gerade offenen Ziehvorgang. `rest` sind die Anwendungen, die
 * nach diesem Zug noch bleiben; `null` heißt, das war die letzte. Steht der
 * Atom selbst auf null, läuft dieser Zug ohne Nachschlag.
 */
export const nachschlagZug = atom<{ rest: number | null } | null>(null);

/** Laufende Flüche. Beide Rollen sehen dieselbe Liste. */
export const activeCurses = atom<Fluch[]>([]);

/**
 * Die vom Glücksrad gesperrte Fragekategorie, oder null ohne laufende Sperre.
 * Beide Rollen sehen sie — das Glücksrad ist keine geheime Karte.
 */
export const gesperrteKategorie = atom<Fragekategorie | null>(null);

/**
 * Der zuletzt eingeschlagene Fluch, solange das Overlay ihn zeigt.
 * Wird vom Overlay selbst wieder auf null gesetzt.
 */
export const eingeschlagenerFluch = atom<Fluch | null>(null);

interface CardsSyncEvent {
    cardsEnabled: boolean;
    hand?: HandKarte[];
    deckRest?: number;
    pendingDraw?: PendingDraw | null;
    activeCurses?: Fluch[];
    gesperrteKategorie?: Fragekategorie | null;
}

/**
 * Kartenfelder aus dem sync-Ereignis übernehmen.
 * Fehlende Felder werden geleert, nicht beibehalten — sonst bliebe die Hand
 * stehen, wenn der Server sie nicht mehr schickt.
 */
export function applyCardsSync(event: CardsSyncEvent): void {
    cardsEnabled.set(event.cardsEnabled);
    hand.set(event.hand ?? []);
    deckRest.set(event.deckRest ?? 0);
    pendingDraw.set(event.pendingDraw ?? null);
    // Das sync-Ereignis trägt die Nachschlagfelder nicht. Nach einem Neuladen
    // mitten im Ziehen zeigen wir deshalb keinen Hinweis, statt eine Restzahl
    // zu raten — die vierte Karte liegt sichtbar da, nur unkommentiert.
    nachschlagZug.set(null);
    activeCurses.set(event.activeCurses ?? []);
    gesperrteKategorie.set(event.gesperrteKategorie ?? null);
}

export function applyHandUpdated(event: {
    hand: HandKarte[];
    deckRest: number;
    pendingDraw?: PendingDraw | null;
}): void {
    hand.set(event.hand);
    deckRest.set(event.deckRest);
    pendingDraw.set(event.pendingDraw ?? null);
    nachschlagZug.set(null);
}

export function applyCursePlayed(event: { curse: Fluch }): void {
    const bisher = activeCurses.get();
    if (bisher.some((f) => f.id === event.curse.id)) return;
    activeCurses.set([...bisher, event.curse]);
}

export function applyCurseEnded(event: {
    curseId: string;
    endedBy: string;
    endedAt: string;
}): void {
    const beendet = activeCurses.get().find((f) => f.id === event.curseId);
    activeCurses.set(activeCurses.get().filter((f) => f.id !== event.curseId));
    // Das Ende des Glücksrads hebt die Sperre auf. Der Server schickt dazu kein
    // eigenes Ereignis, also lösen wir es hier am Kartentyp ab.
    if (beendet?.karte.id === GLUECKSRAD_ID) {
        gesperrteKategorie.set(null);
    }
}

/** Das Glücksrad hat gelost — beim Ausspielen und nach jeder gestellten Frage. */
export function applyLockedCategory(event: {
    curseId: string;
    kategorie: Fragekategorie;
}): void {
    gesperrteKategorie.set(event.kategorie);
}

/** Alles zurücksetzen — beim Verlassen der Sitzung. */
export function resetDeckState(): void {
    cardsEnabled.set(false);
    hand.set([]);
    deckRest.set(0);
    pendingDraw.set(null);
    nachschlagZug.set(null);
    activeCurses.set([]);
    gesperrteKategorie.set(null);
    eingeschlagenerFluch.set(null);
}

/**
 * Summe der Bonusminuten auf der Hand, für die Spielgröße dieser Sitzung.
 * Reine Anzeige, wird nirgends verrechnet.
 */
export function bonusMinutenAufDerHand(
    karten: HandKarte[],
    gameSize: "S" | "M" | "L" | null,
): number {
    const g = gameSize ?? "M";
    return karten.reduce((n, k) => n + (k.karte.bonusMin?.[g] ?? 0), 0);
}
