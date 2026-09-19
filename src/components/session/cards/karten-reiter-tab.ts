/**
 * Sichtbarkeit und Beschriftung des Kartenreiters im Bottom Sheet.
 *
 * Eigene Datei ohne React-Import, damit die Regeln im Test ohne Leaflet und
 * WebSocket geladen werden können.
 */
import type { BottomSheetTab } from "@/components/ui/BottomSheet";

/** Gibt null zurück, wenn kein Reiter erscheinen soll. */
export function kartenReiter({
    cardsEnabled,
    istHider,
    handAnzahl,
    fluchAnzahl,
    tr,
}: {
    cardsEnabled: boolean;
    istHider: boolean | null;
    handAnzahl: number;
    fluchAnzahl: number;
    tr: (key: any) => string;
}): BottomSheetTab | null {
    if (!cardsEnabled || istHider === null) return null;
    const name = istHider ? tr("cards.tabHand") : tr("cards.tabCurses");
    const zahl = istHider ? handAnzahl : fluchAnzahl;
    return { id: "karten", label: zahl > 0 ? `${name} ${zahl}` : name };
}
