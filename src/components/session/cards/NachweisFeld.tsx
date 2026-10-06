/**
 * Nachweise an einem laufenden Fluch: die vorhandenen als Vorschaubilder, dazu
 * ein Knopf, der neue hochlaedt.
 *
 * Der Knopf haengt an `karte.nachweisUpload`, nicht an `karte.nachweis`: den
 * zweiten tragen nur sechs der zwoelf Flueche, er ist eine Abschrift der
 * gedruckten Karte und keine Funktion.
 *
 * Bei `nachweisUpload: "video"` erscheint kein Knopf. Vogelkino und Kegelbahn
 * verlangen zwingend einen Film ("der Wurf, ungeschnitten", "ein Vogel, am
 * Stueck gefilmt"), und `POST /api/upload` nimmt bis Eintrag 8 nur Bilder. Ein
 * Feld, das dort ein Foto annimmt, behauptet einen Beweis, den das Foto nicht
 * liefert.
 */
import type { Fluch } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useRef, useState } from "react";
import { toast } from "react-toastify";

import { locale, t, useT } from "@/i18n";
import { nachweiseHochladen } from "@/lib/cards-api";
import { applyCurseNachweise } from "@/lib/deck-context";
import { ApiError, BASE_URL } from "@/lib/session-api";
import { sessionParticipant } from "@/lib/session-context";

import { FotoBeweis } from "../FotoBeweis";
import { kartenZusatz } from "./karten-stil";

export function NachweisFeld({ curse }: { curse: Fluch }) {
    const tr = useT();
    const $participant = useStore(sessionParticipant);
    const [laedt, setLaedt] = useState(false);
    const dateiRef = useRef<HTMLInputElement>(null);

    // "beides" heisst "Foto oder Video"; das Foto reicht, also Knopf an.
    const darfHochladen =
        curse.karte.nachweisUpload === "bild" || curse.karte.nachweisUpload === "beides";

    if (!darfHochladen && curse.nachweise.length === 0) return null;

    async function hochladen(dateien: File[]) {
        const token = $participant?.token;
        if (!token || dateien.length === 0 || laedt) return;
        setLaedt(true);
        try {
            // Alle Dateien in einem Aufruf, siehe nachweiseHochladen.
            const nachweise = await nachweiseHochladen(curse.id, token, dateien);
            // Die Gegenseite erfaehrt es ueber curse_nachweise. Die eigene
            // Anzeige stellen wir aus der Antwort, statt auf das eigene
            // Ereignis zu warten.
            applyCurseNachweise({ curseId: curse.id, nachweise });
        } catch (e) {
            // t(…, locale.get()) statt tr(…): in einer Rückruffunktion, die
            // nach einem await läuft, wäre die Sprache aus dem Render alt.
            toast.error(
                e instanceof ApiError
                    ? e.message
                    : t("cards.proofUploadFailed", locale.get()),
            );
        } finally {
            setLaedt(false);
            // Zuruecksetzen, sonst loest dieselbe Datei kein zweites change aus.
            if (dateiRef.current) dateiRef.current.value = "";
        }
    }

    return (
        <div
            data-nachweisfeld={curse.id}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
            {curse.nachweise.length > 0 ? (
                <>
                    <p style={kartenZusatz}>
                        <strong>{tr("cards.proofsUploaded")}:</strong> {curse.nachweise.length}
                    </p>
                    {curse.nachweise.map((n) => (
                        <FotoBeweis key={n.url} src={`${BASE_URL}${n.url}`} />
                    ))}
                </>
            ) : null}

            {darfHochladen ? (
                <>
                    <input
                        ref={dateiRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => void hochladen(Array.from(e.target.files ?? []))}
                        style={{ display: "none" }}
                    />
                    <button
                        type="button"
                        data-nachweis-knopf={curse.id}
                        onClick={() => dateiRef.current?.click()}
                        disabled={laedt}
                        style={{
                            alignSelf: "flex-start",
                            background: "transparent",
                            border: "2px solid rgba(245,245,240,0.2)",
                            borderRadius: "var(--radius-pill)",
                            padding: "9px 18px",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: laedt ? "default" : "pointer",
                            opacity: laedt ? 0.5 : 1,
                        }}
                    >
                        📸 {laedt ? tr("cards.proofUploading") : tr("cards.proofUpload")}
                    </button>
                </>
            ) : null}
        </div>
    );
}
