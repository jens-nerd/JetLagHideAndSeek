/**
 * Startpunkt einer neuen Radiusfrage (RadiusConfig).
 *
 * Hintergrund (22.09.2026): Zwei Radiusfragen landeten in der Produktions-DB
 * mit Koordinaten, die exakt auf dem Pixelraster der Leaflet-Karte liegen
 * (Zoom 6 bzw. 7) - also mit der Kartenmitte, nicht mit der GPS-Position.
 * Die Karte zeigte "Ich" zu dem Zeitpunkt korrekt in Hamburg. RadiusConfig
 * startete mit `map.getCenter()` und verliess sich darauf, dass der eigene
 * GPS-Abruf der LocationCard rechtzeitig zurueckkommt. Kam er nicht (noch
 * unterwegs oder gescheitert), ging die Kartenmitte raus.
 *
 * Der Test rendert statisch: Effekte laufen nicht, der GPS-Abruf der
 * LocationCard also auch nicht. Angezeigt wird damit genau der Startwert.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        defaultUnit: box<string>("kilometers"),
        // Kartenmitte wie beim Start einer Session mit Gebiet "Germany"
        leafletMapContext: box<any>({
            getCenter: () => ({ lat: 51.33061163769853, lng: 10.437011718750002 }),
        }),
        ownGpsPosition: box<{ lat: number; lng: number } | null>(null),
        sessionCode: box<string | null>("ABCDEF"),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        pickerOpen: box<boolean>(true),
        bottomSheetState: box<string>("expanded"),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));
vi.mock("leaflet", () => ({ circle: () => ({ addTo: () => {} }) }));
vi.mock("react-toastify", () => ({ toast: { error: () => {} } }));
vi.mock("@/lib/context", () => ({
    defaultUnit: stores.defaultUnit,
    leafletMapContext: stores.leafletMapContext,
}));
vi.mock("@/lib/session-context", () => ({
    sessionCode: stores.sessionCode,
    sessionParticipant: stores.sessionParticipant,
    ownGpsPosition: stores.ownGpsPosition,
}));
vi.mock("@/lib/bottom-sheet-state", () => ({
    pickerOpen: stores.pickerOpen,
    bottomSheetState: stores.bottomSheetState,
}));
vi.mock("@/lib/session-api", () => ({ addQuestion: async () => {} }));
vi.mock("@/lib/handle-submit-error", () => ({ handleSubmitError: () => {} }));

import { RadiusConfig } from "../session/picker/RadiusConfig";

function render() {
    return renderToStaticMarkup(
        <RadiusConfig
            wsStatus={"connected" as any}
            onBack={() => {}}
            onSettings={() => {}}
            onClose={() => {}}
        />,
    );
}

describe("RadiusConfig - Startpunkt", () => {
    beforeEach(() => {
        stores.ownGpsPosition.set(null);
    });

    it("startet an der eigenen GPS-Position, wenn sie bekannt ist", () => {
        // Hamburg, wie der "Ich"-Marker auf Jens' Screenshot
        stores.ownGpsPosition.set({ lat: 53.5511, lng: 9.9937 });
        const html = render();
        expect(html).toContain("53.5511° N, 9.9937° E");
        expect(html).not.toContain("51.3306° N");
    });

    it("faellt ohne GPS-Position auf die Kartenmitte zurueck", () => {
        const html = render();
        expect(html).toContain("51.3306° N, 10.4370° E");
    });
});
