/**
 * Prüft den zweistufigen Weg der Fluch-Nachweise: jede Datei einzeln nach
 * /api/upload, dann ein einziger Aufruf des Nachweis-Endpunkts mit allen
 * Adressen.
 *
 * Der eine Aufruf ist der Punkt. Flo hat belegt, dass von fünf gleichzeitigen
 * Einzelaufrufen ohne Transaktion nur einer übrig bleibt; mit einem Aufruf
 * stellt sich die Frage nicht.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    bildHochladen: vi.fn(),
    apiFetch: vi.fn(),
}));

vi.mock("../session-api", () => ({
    bildHochladen: mocks.bildHochladen,
    apiFetch: mocks.apiFetch,
}));

function datei(name: string): File {
    return new File(["x"], name, { type: "image/jpeg" });
}

describe("nachweiseHochladen", () => {
    beforeEach(() => {
        mocks.bildHochladen.mockReset();
        mocks.apiFetch.mockReset();
        mocks.bildHochladen.mockImplementation((d: File) =>
            Promise.resolve({ url: `/uploads/${d.name}` }),
        );
        mocks.apiFetch.mockResolvedValue({ nachweise: [] });
    });

    it("schickt drei Dateien in einem Aufruf raus", async () => {
        const { nachweiseHochladen } = await import("../cards-api");

        await nachweiseHochladen("c1", "tok", [datei("a.jpg"), datei("b.jpg"), datei("c.jpg")]);

        expect(mocks.bildHochladen).toHaveBeenCalledTimes(3);
        expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

        const [pfad, optionen] = mocks.apiFetch.mock.calls[0];
        expect(pfad).toBe("/api/curses/c1/nachweise");
        expect(optionen.token).toBe("tok");
        expect(JSON.parse(optionen.body)).toEqual({
            nachweise: [
                { url: "/uploads/a.jpg", art: "bild" },
                { url: "/uploads/b.jpg", art: "bild" },
                { url: "/uploads/c.jpg", art: "bild" },
            ],
        });
    });

    it("behält die Reihenfolge der Dateien", async () => {
        const { nachweiseHochladen } = await import("../cards-api");

        await nachweiseHochladen("c1", "tok", [datei("3.jpg"), datei("1.jpg"), datei("2.jpg")]);

        const koerper = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
        expect(koerper.nachweise.map((n: { url: string }) => n.url)).toEqual([
            "/uploads/3.jpg",
            "/uploads/1.jpg",
            "/uploads/2.jpg",
        ]);
    });

    it("gibt die ganze Liste des Servers zurück, nicht nur den Zuwachs", async () => {
        const alt = { url: "/uploads/alt.jpg", art: "bild", von: "p1", am: "2026-10-05T10:00:00.000Z" };
        const neu = { url: "/uploads/a.jpg", art: "bild", von: "p1", am: "2026-10-06T10:00:00.000Z" };
        mocks.apiFetch.mockResolvedValue({ nachweise: [alt, neu] });

        const { nachweiseHochladen } = await import("../cards-api");
        const liste = await nachweiseHochladen("c1", "tok", [datei("a.jpg")]);

        expect(liste).toEqual([alt, neu]);
    });

    it("hängt nichts an, wenn schon der Bild-Upload scheitert", async () => {
        mocks.bildHochladen.mockRejectedValue(new Error("zu gross"));

        const { nachweiseHochladen } = await import("../cards-api");

        await expect(nachweiseHochladen("c1", "tok", [datei("a.jpg")])).rejects.toThrow("zu gross");
        expect(mocks.apiFetch).not.toHaveBeenCalled();
    });
});
