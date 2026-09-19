/**
 * Ziehkosten je Fragenkategorie.
 *
 * Die Tabelle steht in shared/src/karten.ts, weil das Backend sie beim Ziehen
 * ebenfalls braucht. Diese Datei bleibt als Re-Export bestehen, damit die
 * vorhandenen Aufrufstellen unverändert weiterlaufen.
 */
export { CARD_COSTS, getCardCost } from "@hideandseek/shared";
