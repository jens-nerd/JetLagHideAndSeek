/**
 * Unit-Tests für den Photon-URL-Bau.
 *
 * Getestet wird nur `buildGeocodeUrl` – eine reine Funktion, kein DOM, kein
 * Netzwerk. Beide Suchstellen (PlacePicker im Spielgebiet-Schritt,
 * LocationCard im laufenden Spiel) bauen ihre Anfrage über sie, damit
 * Sprache, Nähe-Gewichtung und Encoding nicht wieder auseinanderlaufen.
 */

import { describe, expect, it } from "vitest";

import { buildGeocodeUrl } from "@/maps/api/geocode";

const params = (url: string) => new URL(url).searchParams;

describe("buildGeocodeUrl", () => {
    it("zeigt auf Photon und setzt Sprache und Suchbegriff", () => {
        const url = buildGeocodeUrl("Hamburg", "de");

        expect(url.startsWith("https://photon.komoot.io/api/?")).toBe(true);
        expect(params(url).get("lang")).toBe("de");
        expect(params(url).get("q")).toBe("Hamburg");
    });

    it("reicht die App-Sprache durch, statt en fest zu verdrahten", () => {
        expect(params(buildGeocodeUrl("Hamburg", "en")).get("lang")).toBe("en");
        expect(params(buildGeocodeUrl("Hamburg", "de")).get("lang")).toBe("de");
    });

    it("kodiert Leerzeichen und Umlaute", () => {
        const url = buildGeocodeUrl("Frankfurt am Main", "de");

        expect(url).not.toContain("Frankfurt am Main");
        expect(url).toContain("Frankfurt+am+Main");
        expect(params(url).get("q")).toBe("Frankfurt am Main");
    });

    it("kodiert Umlaute und Sonderzeichen, die die Query sonst zerlegen", () => {
        expect(params(buildGeocodeUrl("Münster", "de")).get("q")).toBe(
            "Münster",
        );
        expect(buildGeocodeUrl("Münster", "de")).toContain("M%C3%BCnster");

        const tricky = buildGeocodeUrl("Baden & Baden #1", "de");
        expect(params(tricky).get("q")).toBe("Baden & Baden #1");
        expect(params(tricky).get("lang")).toBe("de");
    });

    it("hängt die Nähe-Gewichtung an, wenn beide Koordinaten vorliegen", () => {
        const url = buildGeocodeUrl("Ham", "de", { lat: 53.55, lon: 9.99 });

        expect(params(url).get("lat")).toBe("53.55");
        expect(params(url).get("lon")).toBe("9.99");
    });

    it("lässt die Nähe-Gewichtung weg, wenn keine Karte verfügbar ist", () => {
        const url = buildGeocodeUrl("Ham", "de", {});

        expect(params(url).has("lat")).toBe(false);
        expect(params(url).has("lon")).toBe(false);
    });

    it("setzt limit und osm_tag nur, wenn angefragt", () => {
        const spielgebiet = buildGeocodeUrl("Ham", "de", {
            limit: 15,
            osmTag: "place",
        });
        expect(params(spielgebiet).get("limit")).toBe("15");
        expect(params(spielgebiet).get("osm_tag")).toBe("place");

        const imSpiel = buildGeocodeUrl("Ham", "de", { limit: 5 });
        expect(params(imSpiel).get("limit")).toBe("5");
        expect(params(imSpiel).has("osm_tag")).toBe(false);
    });
});
