/**
 * TimerSettings — "Timer" tab in settings.
 *
 * - Hiding Timer: duration selector (5 min steps, up to 4h) + start/cancel
 * - Hiding-Time stopwatch: starts when timer expires, display only
 */
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";

import {
    cancelHidingTimer,
    hidingStopwatchStart,
    hidingTimerDuration,
    hidingTimerEnd,
    startHidingTimer,
    startStopwatch,
} from "@/lib/timer-context";

import { SettingsRow } from "./SettingsRow";

// ── Duration options (5 min steps, 5–240) ───────────────────────────────────
const DURATION_OPTIONS: number[] = [];
for (let m = 5; m <= 240; m += 5) DURATION_OPTIONS.push(m);

function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} h`;
    return `${h} h ${m} min`;
}

function formatMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
    background: "#1E1E2A",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    padding: "10px 40px 10px 14px",
    width: "100%",
    outline: "none",
    appearance: "none" as const,
    fontFamily: "inherit",
    backgroundImage:
        `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7' viewBox='0 0 12 7'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B7280' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center",
    cursor: "pointer",
};

const btnBase: React.CSSProperties = {
    border: "none",
    borderRadius: 10,
    padding: "12px",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "Poppins, sans-serif",
    width: "100%",
};

// ── Component ───────────────────────────────────────────────────────────────

export function TimerSettings() {
    const $duration = useStore(hidingTimerDuration);
    const $timerEnd = useStore(hidingTimerEnd);
    const $stopwatchStart = useStore(hidingStopwatchStart);
    const [now, setNow] = useState(Date.now());

    const timerActive = $timerEnd !== null;
    const stopwatchActive = $stopwatchStart !== null;

    // Tick every second when timer or stopwatch is active
    useEffect(() => {
        if (!timerActive && !stopwatchActive) return;
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [timerActive, stopwatchActive]);

    // Auto-start stopwatch when timer expires
    useEffect(() => {
        if (!$timerEnd || $stopwatchStart) return;
        const remaining = new Date($timerEnd).getTime() - Date.now();
        if (remaining <= 0) {
            startStopwatch();
        }
    }, [$timerEnd, $stopwatchStart, now]);

    // Computed values
    const timerRemainingMs = $timerEnd
        ? Math.max(0, new Date($timerEnd).getTime() - now)
        : 0;
    const timerExpired = $timerEnd !== null && timerRemainingMs <= 0;

    const stopwatchElapsedMs = $stopwatchStart
        ? now - new Date($stopwatchStart).getTime()
        : 0;

    return (
        <div style={{ padding: "0 16px" }}>
            {/* ── Hiding Timer ── */}
            <div style={{
                padding: "14px 0",
                borderBottom: "1px solid rgba(245,245,240,0.08)",
            }}>
                <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                    Hiding Timer
                </div>

                {!timerActive ? (
                    <>
                        {/* Duration selector */}
                        <div style={{ marginBottom: 12 }}>
                            <span style={{
                                color: "#99A1AF",
                                fontSize: 12,
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                display: "block",
                                marginBottom: 6,
                            }}>
                                Dauer
                            </span>
                            <select
                                value={$duration}
                                onChange={(e) => hidingTimerDuration.set(parseInt(e.target.value))}
                                style={selectStyle}
                            >
                                {DURATION_OPTIONS.map((m) => (
                                    <option key={m} value={m}>{formatDuration(m)}</option>
                                ))}
                            </select>
                        </div>
                        {/* Start button */}
                        <button
                            type="button"
                            onClick={startHidingTimer}
                            style={{ ...btnBase, background: "#22C55E", color: "#fff" }}
                        >
                            Timer starten
                        </button>
                    </>
                ) : !timerExpired ? (
                    <>
                        {/* Timer running */}
                        <div style={{
                            background: "rgba(34,197,94,0.08)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            borderRadius: 10,
                            padding: "14px 16px",
                            textAlign: "center",
                            marginBottom: 12,
                        }}>
                            <div style={{ color: "#99A1AF", fontSize: 12, marginBottom: 4 }}>
                                Verbleibend
                            </div>
                            <div style={{
                                color: "#22C55E",
                                fontSize: 32,
                                fontWeight: 800,
                                fontFamily: "Poppins, monospace",
                                letterSpacing: "0.05em",
                            }}>
                                {formatMs(timerRemainingMs)}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={cancelHidingTimer}
                            style={{ ...btnBase, background: "transparent", color: "#E8323A", border: "2px solid #E8323A" }}
                        >
                            Timer abbrechen
                        </button>
                    </>
                ) : (
                    <>
                        {/* Timer expired */}
                        <div style={{
                            background: "rgba(232,50,58,0.08)",
                            border: "1px solid rgba(232,50,58,0.25)",
                            borderRadius: 10,
                            padding: "14px 16px",
                            textAlign: "center",
                            marginBottom: 12,
                        }}>
                            <div style={{ color: "#E8323A", fontSize: 14, fontWeight: 700 }}>
                                Hiding Timer abgelaufen!
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={cancelHidingTimer}
                            style={{ ...btnBase, background: "transparent", color: "#99A1AF", border: "2px solid rgba(255,255,255,0.15)" }}
                        >
                            Timer zurücksetzen
                        </button>
                    </>
                )}
            </div>

            {/* ── Hiding-Time Stopwatch ── */}
            {stopwatchActive && (
                <div style={{
                    padding: "14px 0",
                    borderBottom: "1px solid rgba(245,245,240,0.08)",
                }}>
                    <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                        Hiding-Time
                    </div>
                    <div style={{
                        background: "rgba(232,50,58,0.08)",
                        border: "1px solid rgba(232,50,58,0.25)",
                        borderRadius: 10,
                        padding: "14px 16px",
                        textAlign: "center",
                    }}>
                        <div style={{ color: "#99A1AF", fontSize: 12, marginBottom: 4 }}>
                            Seit Timer-Ablauf
                        </div>
                        <div style={{
                            color: "#E8323A",
                            fontSize: 32,
                            fontWeight: 800,
                            fontFamily: "Poppins, monospace",
                            letterSpacing: "0.05em",
                        }}>
                            {formatMs(stopwatchElapsedMs)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
