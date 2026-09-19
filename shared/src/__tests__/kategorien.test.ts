import { describe, expect, it } from "vitest";

import { CARD_COSTS, FRAGEKATEGORIEN, kategorienFuerSpielgroesse } from "../karten.js";

describe("Fragekategorien", () => {
    it("deckt sich mit den Kennungen in CARD_COSTS", () => {
        expect([...FRAGEKATEGORIEN].sort()).toEqual(Object.keys(CARD_COSTS).sort());
    });

    it("liefert bei S fünf Kategorien ohne tentacles", () => {
        const s = kategorienFuerSpielgroesse("S");
        expect(s).toHaveLength(5);
        expect(s).not.toContain("tentacles");
    });

    it("liefert bei M und L alle sechs", () => {
        expect(kategorienFuerSpielgroesse("M")).toHaveLength(6);
        expect(kategorienFuerSpielgroesse("L")).toHaveLength(6);
        expect(kategorienFuerSpielgroesse("L")).toContain("tentacles");
    });

    it("behandelt fehlende und unbekannte Spielgröße wie M", () => {
        const m = kategorienFuerSpielgroesse("M");
        expect(kategorienFuerSpielgroesse(null)).toEqual(m);
        expect(kategorienFuerSpielgroesse(undefined)).toEqual(m);
        expect(kategorienFuerSpielgroesse("XL" as never)).toEqual(m);
    });

    it("gibt eine eigene Liste zurück, die der Aufrufer nicht teilt", () => {
        const a = kategorienFuerSpielgroesse("M");
        a.pop();
        expect(kategorienFuerSpielgroesse("M")).toHaveLength(6);
    });
});
