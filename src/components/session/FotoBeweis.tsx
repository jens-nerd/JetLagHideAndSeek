/**
 * Fotobeweis: Vorschaubild + Vollbild-Overlay.
 *
 * Lag bis Eintrag 7 in SessionQuestionPanel.tsx. Herausgezogen, weil die
 * Fluch-Nachweise dasselbe Overlay brauchen und zwei Kopien davon zwei
 * Zurueck-Tasten-Fehler statt einem bedeuten.
 */
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

/**
 * Das Vorschaubild im Verlauf plus das Overlay, das es gross zeigt.
 *
 * Vorher hing das Bild in einem echten Navigationslink. Die Uploads liegen auf
 * derselben Domain und damit im `scope` der PWA: im Standalone-Fenster gibt es
 * keine Browser-Oberflaeche, also auch kein Zurueck. Wer draufgetippt hat, kam
 * nur noch per Wischen von der Bildschirmkante oder Neustart aus dem Bild
 * heraus. Deshalb ein Overlay, das nirgendwo hin navigiert.
 */
export function FotoBeweis({ src }: { src: string }) {
    const tr = useT();
    const [offen, setOffen] = useState(false);
    const [sichert, setSichert] = useState(false);

    // Die Android-Zurueck-Taste soll das Overlay schliessen, nicht die Runde
    // verlassen. Ein zusaetzlicher History-Eintrag gibt der Taste etwas zum
    // Wegnehmen; Radix selbst hoert nur auf Escape.
    useEffect(() => {
        if (!offen) return;
        history.pushState({ hsFotoOverlay: true }, "");
        const aufPop = () => setOffen(false);
        window.addEventListener("popstate", aufPop);
        return () => {
            window.removeEventListener("popstate", aufPop);
            // Geschlossen per X oder Escape: unser Eintrag liegt noch oben und
            // muss weg, sonst braucht die Zurueck-Taste zwei Tipps. Kam das
            // Schliessen von popstate, ist er schon abgeraeumt.
            if (history.state?.hsFotoOverlay) history.back();
        };
    }, [offen]);

    /**
     * Legt das Bild in die Fotos des Telefons — ueber das Freigabeblatt, weil
     * das der einzige Weg ist, der auf iOS dort ankommt und dabei nicht
     * navigiert. Das Blatt legt sich ueber die App, der Zustand bleibt stehen.
     * Wo es fehlt, bleibt ein Download; der landet in den Downloads, nicht in
     * den Fotos. Beides braucht einen zweiten Tipp, darum heisst der Knopf
     * nicht "speichern".
     */
    async function fotoSichern() {
        setSichert(true);
        try {
            const antwort = await fetch(src);
            if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
            const blob = await antwort.blob();
            const name = src.split("/").pop() || "fotobeweis.jpg";
            const datei = new File([blob], name, {
                type: blob.type || "image/jpeg",
            });

            if (navigator.canShare?.({ files: [datei] })) {
                await navigator.share({ files: [datei] });
                return;
            }

            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Nicht sofort freigeben: Safari bricht den Download sonst ab.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
        } catch (e: unknown) {
            // Abgebrochenes Freigabeblatt ist kein Fehler, sondern ein "nein".
            if (e instanceof DOMException && e.name === "AbortError") return;
            toast.error(tr("sqp.photoSaveFailed"));
        } finally {
            setSichert(false);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOffen(true)}
                aria-label={tr("sqp.photoOpen")}
                style={{
                    marginTop: 4,
                    padding: 0,
                    border: "none",
                    background: "none",
                    borderRadius: 6,
                    overflow: "hidden",
                    display: "block",
                    cursor: "pointer",
                }}
            >
                <img
                    src={src}
                    alt={tr("sqp.photoProof")}
                    style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 6 }}
                />
            </button>

            <Dialog open={offen} onOpenChange={setOffen}>
                {/* `text-white` muss mit: der schwarze Grund ueberschreibt
                    `bg-background`, das X von DialogContent erbt aber seine
                    Farbe. Die `[&>button]`-Groesse macht daraus ein Ziel, das
                    ein Daumen trifft — 16px Icon allein reichen nicht. */}
                <DialogContent className="flex flex-col w-screen max-w-none h-[100dvh] gap-0 rounded-none border-0 p-0 bg-black/95 text-white [&>button]:right-2 [&>button]:top-2 [&>button]:grid [&>button]:h-10 [&>button]:w-10 [&>button]:place-items-center">
                    <DialogHeader className="shrink-0 px-4 pb-2 pt-4 pr-12">
                        <DialogTitle className="text-left text-base text-white">
                            {tr("sqp.photoProof")}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Aufziehen zum Zoomen: der Bereich scrollt in beide
                        Richtungen, `pinch-zoom` laesst die Geste durch, statt
                        sie wie `none` zu verschlucken. */}
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            overflow: "auto",
                            touchAction: "pinch-zoom",
                            WebkitOverflowScrolling: "touch",
                        }}
                    >
                        <img
                            src={src}
                            alt={tr("sqp.photoProof")}
                            style={{ width: "100%", height: "auto", display: "block" }}
                        />
                    </div>

                    <div className="shrink-0 px-4 pb-6 pt-3">
                        <Button
                            onClick={() => void fotoSichern()}
                            disabled={sichert}
                            className="w-full border-0 font-bold text-white disabled:opacity-40"
                            style={{ backgroundColor: "#067BC2" }}
                        >
                            📥 {tr("sqp.photoShare")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
