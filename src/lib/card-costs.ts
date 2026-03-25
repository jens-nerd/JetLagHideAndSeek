/**
 * Card costs per question category.
 *
 * After answering a question, the hider may draw `draw` cards and keep `keep`.
 */
export const CARD_COSTS: Record<string, { draw: number; keep: number }> = {
    radius:      { draw: 2, keep: 1 },
    matching:    { draw: 3, keep: 1 },
    measuring:   { draw: 3, keep: 1 },
    thermometer: { draw: 2, keep: 1 },
    photo:       { draw: 1, keep: 1 },
    tentacles:   { draw: 4, keep: 2 },
};

export function getCardCost(type: string): { draw: number; keep: number } | null {
    return CARD_COSTS[type] ?? null;
}
