/**
 * MyZonePanel — simplified hiding zone selection for the hider.
 *
 * States:
 *   - No zone: "Versteckzone wählen" button → station search
 *   - Zone set: Station name + radius display, "Zone ändern" + "Endgame freigeben"
 *   - Zone revealed: Same as set, but "Endgame aktiv" (disabled)
 */
import { useStore } from "@nanostores/react";
import { useState } from "react";
import { toast } from "react-toastify";

import { hidingRadius, hidingRadiusUnits } from "@/lib/context";
import {
    activeHidingZone,
    sessionCode,
    sessionParticipant,
    wsInstance,
} from "@/lib/session-context";

export function MyZonePanel({ stations }: {
    stations: Array<{
        properties: {
            properties: { id: string; name?: string; "name:en"?: string };
            geometry: { coordinates: [number, number] };
        };
    }>;
}) {
    const $zone = useStore(activeHidingZone);
    const $ws = useStore(wsInstance);
    const $participant = useStore(sessionParticipant);
    const $hidingRadius = useStore(hidingRadius);
    const $hidingRadiusUnits = useStore(hidingRadiusUnits);

    const [searching, setSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmReveal, setConfirmReveal] = useState(false);

    const isHider = $participant?.role === "hider";
    if (!isHider) return null;

    function sendSetZone(station: typeof stations[number]) {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        const name =
            station.properties.properties["name:en"] ||
            station.properties.properties.name ||
            "Unbekannt";
        const [lng, lat] = station.properties.geometry.coordinates;

        $ws.send(JSON.stringify({
            type: "set_hiding_zone",
            stationName: name,
            lat,
            lng,
            radius: $hidingRadius,
            radiusUnit: $hidingRadiusUnits,
        }));

        setSearching(false);
        setSearchQuery("");
        toast.success(`Versteckzone gesetzt: ${name}`);
    }

    function sendReveal() {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        $ws.send(JSON.stringify({ type: "reveal_hiding_zone" }));
        setConfirmReveal(false);
        toast.success("Endgame freigegeben!");
    }

    // ── Station search view ──────────────────────────────────────────────────
    if (searching) {
        const filtered = stations.filter((s) => {
            const name = (
                s.properties.properties["name:en"] ||
                s.properties.properties.name ||
                ""
            ).toLowerCase();
            return name.includes(searchQuery.toLowerCase());
        });

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Versteckzone suchen…"
                    autoFocus
                    style={{
                        background: "#1E1E2A",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10,
                        color: "#fff",
                        fontSize: "14px",
                        padding: "10px 14px",
                        outline: "none",
                        fontFamily: "inherit",
                    }}
                />
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {filtered.length === 0 && (
                        <p style={{ color: "#6B7280", fontSize: "13px", padding: "8px 0" }}>
                            Keine Ergebnisse
                        </p>
                    )}
                    {filtered.map((s) => {
                        const name =
                            s.properties.properties["name:en"] ||
                            s.properties.properties.name ||
                            "Unbekannt";
                        return (
                            <button
                                key={s.properties.properties.id}
                                type="button"
                                onClick={() => sendSetZone(s)}
                                style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "10px 12px",
                                    background: "transparent",
                                    border: "none",
                                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                                    color: "#E5E7EB",
                                    fontSize: "14px",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                }}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={() => { setSearching(false); setSearchQuery(""); }}
                    style={{
                        color: "#99A1AF",
                        textDecoration: "underline",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                        padding: "4px 0",
                    }}
                >
                    Abbrechen
                </button>
            </div>
        );
    }

    // ── Confirm reveal dialog ────────────────────────────────────────────────
    if (confirmReveal) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "16px 0",
                textAlign: "center",
            }}>
                <p style={{ color: "#E5E7EB", fontSize: "14px", margin: 0 }}>
                    Die Zone wird für alle Seeker sichtbar. Fortfahren?
                </p>
                <button
                    type="button"
                    onClick={sendReveal}
                    style={{
                        background: "#E8323A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "15px",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                    }}
                >
                    Endgame freigeben
                </button>
                <button
                    type="button"
                    onClick={() => setConfirmReveal(false)}
                    style={{
                        color: "#99A1AF",
                        textDecoration: "underline",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                    }}
                >
                    Abbrechen
                </button>
            </div>
        );
    }

    // ── No zone set ──────────────────────────────────────────────────────────
    if (!$zone) {
        return (
            <div style={{ padding: "16px 0", textAlign: "center" }}>
                <p style={{ color: "#6B7280", fontSize: "13px", marginBottom: 12 }}>
                    Noch keine Versteckzone gewählt.
                </p>
                <button
                    type="button"
                    onClick={() => setSearching(true)}
                    disabled={stations.length === 0}
                    style={{
                        background: "#22C55E",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "14px 24px",
                        fontWeight: 800,
                        fontSize: "15px",
                        cursor: stations.length === 0 ? "not-allowed" : "pointer",
                        opacity: stations.length === 0 ? 0.4 : 1,
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Versteckzone wählen
                </button>
                {stations.length === 0 && (
                    <p style={{ color: "#F59E0B", fontSize: "12px", marginTop: 8 }}>
                        Aktiviere zuerst Versteckzonen im "Alle Zonen"-Tab.
                    </p>
                )}
            </div>
        );
    }

    // ── Zone set ─────────────────────────────────────────────────────────────
    const unitLabel = $zone.radiusUnit === "miles" ? "mi" : "km";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
            <div style={{
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.25)",
                borderRadius: 10,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}>
                <span style={{ color: "#22C55E", fontSize: "15px", fontWeight: 700 }}>
                    {$zone.stationName}
                </span>
                <span style={{ color: "#99A1AF", fontSize: "12px" }}>
                    Radius: {$zone.radius} {unitLabel}
                </span>
                {$zone.revealed && (
                    <span style={{ color: "#F59E0B", fontSize: "12px", fontWeight: 600, marginTop: 2 }}>
                        Endgame aktiv — Seeker sehen diese Zone
                    </span>
                )}
            </div>

            <button
                type="button"
                onClick={() => setSearching(true)}
                disabled={stations.length === 0}
                style={{
                    background: "transparent",
                    color: "#22C55E",
                    border: "2px solid #22C55E",
                    borderRadius: 10,
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: stations.length === 0 ? "not-allowed" : "pointer",
                    opacity: stations.length === 0 ? 0.4 : 1,
                    fontFamily: "Poppins, sans-serif",
                    width: "100%",
                }}
            >
                Zone ändern
            </button>

            {!$zone.revealed ? (
                <button
                    type="button"
                    onClick={() => setConfirmReveal(true)}
                    style={{
                        background: "#E8323A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "14px",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Endgame freigeben
                </button>
            ) : (
                <button
                    type="button"
                    disabled
                    style={{
                        background: "#2A2A3A",
                        color: "#6B7280",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "14px",
                        cursor: "not-allowed",
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Endgame aktiv
                </button>
            )}
        </div>
    );
}
