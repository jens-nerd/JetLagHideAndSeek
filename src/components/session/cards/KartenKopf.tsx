/**
 * Die Kopfzeile einer Karte: links die Kartenart, rechts ihr Wert oder ihre
 * Restzeit. Sitzt bündig oben auf der Kartenfläche.
 */
import type { ReactNode } from "react";

import { useT } from "@/i18n";

import { kartenArt } from "./karten-stil";

export function KartenKopf({
    art,
    rechts,
}: {
    art: "fluch" | "zeitbonus";
    rechts?: ReactNode;
}) {
    const tr = useT();
    const { kopfFarbe, label, zeichen } = kartenArt(art);

    return (
        <div
            data-kartenart={art}
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                background: kopfFarbe,
                padding: "7px 12px",
            }}
        >
            <span
                style={{
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}
            >
                {zeichen} {tr(label)}
            </span>
            {rechts ? (
                <span
                    style={{
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        textAlign: "right",
                        minWidth: 0,
                    }}
                >
                    {rechts}
                </span>
            ) : null}
        </div>
    );
}
