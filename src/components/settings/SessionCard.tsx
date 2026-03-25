import { useStore } from "@nanostores/react";
import { toast } from "react-toastify";
import { useT } from "@/i18n";
import {
    sessionCode,
    sessionParticipant,
    sessionMembers,
    leaveSession,
} from "@/lib/session-context";

export function SessionCard() {
    const tr = useT();
    const $code = useStore(sessionCode);
    const $participant = useStore(sessionParticipant);
    const $members = useStore(sessionMembers);

    if (!$participant || !$code) return null;

    const roleName = $participant.role === "hider"
        ? tr("session.hider")
        : tr("session.seeker");

    function copyCode() {
        navigator.clipboard.writeText($code!).then(
            () => toast.success("Code kopiert!", { autoClose: 1000 }),
            () => toast.error("Kopieren fehlgeschlagen"),
        );
    }

    // Other members (exclude self)
    const others = $members.filter((m) => m.id !== $participant!.id);

    return (
        <div
            style={{
                background: "var(--color-panel)",
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 8,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                }}
            >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ color: "#99A1AF", fontSize: 14 }}>
                        {tr("session.label")}
                    </span>
                    <span
                        onClick={copyCode}
                        title="Klicken zum Kopieren"
                        style={{
                            color: "#fff",
                            fontSize: 22,
                            fontWeight: 800,
                            fontFamily: "'Poppins', sans-serif",
                            letterSpacing: "0.04em",
                            cursor: "pointer",
                            borderBottom: "2px dashed rgba(255,255,255,0.3)",
                        }}
                    >
                        {$code}
                    </span>
                </div>
                <button
                    onClick={() => leaveSession()}
                    style={{
                        background: "var(--hs-dark)",
                        border: "1px solid rgba(245,245,240,0.15)",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "6px 14px",
                        cursor: "pointer",
                    }}
                >
                    {tr("session.leave")}
                </button>
            </div>
            <div style={{ color: "#99A1AF", fontSize: 13 }}>
                {tr("session.youAre")}{" "}
                <span style={{ color: "#fff", fontWeight: 600 }}>{roleName}</span>
                {$participant.displayName && (
                    <>
                        {" · "}
                        <span style={{ color: "#fff" }}>{$participant.displayName}</span>
                    </>
                )}
            </div>

            {/* Other participants */}
            {others.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
                    <span style={{ color: "#99A1AF", fontSize: 12, fontWeight: 600 }}>
                        Mitspieler:
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {others.map((m) => (
                            <span
                                key={m.id}
                                style={{
                                    background: m.role === "hider" ? "rgba(232,50,58,0.2)" : "rgba(34,197,94,0.2)",
                                    color: m.role === "hider" ? "#E8323A" : "#22C55E",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    padding: "3px 8px",
                                    borderRadius: 6,
                                }}
                            >
                                {m.displayName || (m.role === "hider" ? "Hider" : "Seeker")}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
