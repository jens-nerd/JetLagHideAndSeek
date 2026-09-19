/**
 * Kartenmechanik im Frontend.
 *
 * Nichts davon liegt im localStorage: Der Server ist die Wahrheit, und das
 * sync-Ereignis beim Verbinden stellt den Zustand wieder her. Ein Neuladen
 * mitten im Spiel verliert also nichts.
 */
import type { Fluch, HandKarte, PendingDraw } from "@hideandseek/shared";
import { atom } from "nanostores";

/** Kartenmechanik in dieser Sitzung eingeschaltet. */
export const cardsEnabled = atom<boolean>(false);

/** Hand des Versteckenden. Bei Suchenden immer leer. */
export const hand = atom<HandKarte[]>([]);

/** Verbleibende Karten im Deck. */
export const deckRest = atom<number>(0);

/** Offener Ziehvorgang, falls der Versteckende gezogen, aber nicht behalten hat. */
export const pendingDraw = atom<PendingDraw | null>(null);

/** Laufende Flüche. Beide Rollen sehen dieselbe Liste. */
export const activeCurses = atom<Fluch[]>([]);

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
    activeCurses.set(event.activeCurses ?? []);
}

export function applyHandUpdated(event: {
    hand: HandKarte[];
    deckRest: number;
    pendingDraw?: PendingDraw | null;
}): void {
    hand.set(event.hand);
    deckRest.set(event.deckRest);
    pendingDraw.set(event.pendingDraw ?? null);
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
    activeCurses.set(activeCurses.get().filter((f) => f.id !== event.curseId));
}

/** Alles zurücksetzen — beim Verlassen der Sitzung. */
export function resetDeckState(): void {
    cardsEnabled.set(false);
    hand.set([]);
    deckRest.set(0);
    pendingDraw.set(null);
    activeCurses.set([]);
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
