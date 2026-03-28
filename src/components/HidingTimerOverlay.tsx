/**
 * HidingTimerOverlay — compact countdown badge in the top-right corner of the map.
 * Only visible when the hiding timer is active and has not yet expired.
 * Renders inside MapContainer via react-leaflet's useMap.
 */
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";

import {
    hidingTimerEnd,
    hidingStopwatchStart,
    startStopwatch,
} from "@/lib/timer-context";

function formatMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function HidingTimerOverlay() {
    const $timerEnd = useStore(hidingTimerEnd);
    const $stopwatchStart = useStore(hidingStopwatchStart);
    const [now, setNow] = useState(Date.now());
    const map = useMap();

    // Tick every second
    useEffect(() => {
        if (!$timerEnd) return;
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [$timerEnd]);

    if (!$timerEnd) return null;

    const remainingMs = new Date($timerEnd).getTime() - now;
    const expired = remainingMs <= 0;

    // Auto-start stopwatch when timer expires
    if (expired && !$stopwatchStart) {
        startStopwatch();
    }

    // Don't show overlay after timer expired (stopwatch is only in settings)
    if (expired) return null;

    const isUrgent = remainingMs < 60_000;
    const isWarning = !isUrgent && remainingMs < 5 * 60_000;

    const color = isUrgent ? "#E8323A" : isWarning ? "#F59E0B" : "#22C55E";
    const bgColor = isUrgent
        ? "rgba(232,50,58,0.15)"
        : isWarning
            ? "rgba(245,158,11,0.15)"
            : "rgba(34,197,94,0.12)";

    return createPortal(
        <div
            style={{
                position: "absolute",
                top: 50,
                right: 10,
                zIndex: 1000,
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    background: bgColor,
                    backdropFilter: "blur(8px)",
                    border: `1.5px solid ${color}`,
                    borderRadius: 10,
                    padding: "6px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <span style={{ fontSize: 14 }}>⏱</span>
                <span
                    className={isUrgent ? "animate-pulse" : ""}
                    style={{
                        color,
                        fontSize: 16,
                        fontWeight: 800,
                        fontFamily: "Poppins, monospace",
                        letterSpacing: "0.04em",
                    }}
                >
                    {formatMs(remainingMs)}
                </span>
            </div>
        </div>,
        map.getContainer(),
    );
}
