/**
 * useGpsTracking — automatically sends the seeker's GPS position via WebSocket.
 *
 * Starts `navigator.geolocation.watchPosition()` when:
 *   - The participant is a seeker
 *   - A WebSocket connection is open
 *
 * Sends a `position_update` event at most every 15 seconds.
 * Stops when the component unmounts or the session ends.
 */
import { useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";

import {
    ownGpsPosition,
    sessionParticipant,
    wsInstance,
} from "@/lib/session-context";

const SEND_INTERVAL_MS = 15_000;

export function useGpsTracking(): void {
    const participant = useStore(sessionParticipant);
    const ws = useStore(wsInstance);
    const watchIdRef = useRef<number | null>(null);
    const lastSentRef = useRef<number>(0);
    const latestPosRef = useRef<{ lat: number; lng: number } | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        // Only seekers track their GPS
        if (!participant || participant.role !== "seeker" || !ws) {
            return;
        }

        if (!navigator.geolocation) {
            console.warn("[useGpsTracking] Geolocation not supported");
            return;
        }

        function sendPosition() {
            const pos = latestPosRef.current;
            if (!pos || !ws || ws.readyState !== WebSocket.OPEN) return;

            const now = Date.now();
            if (now - lastSentRef.current < SEND_INTERVAL_MS) return;

            lastSentRef.current = now;
            ws.send(
                JSON.stringify({
                    type: "position_update",
                    lat: pos.lat,
                    lng: pos.lng,
                }),
            );
        }

        // Watch GPS position
        watchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
                const pos = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                latestPosRef.current = pos;
                ownGpsPosition.set(pos);
                sendPosition();
            },
            (err) => {
                console.warn("[useGpsTracking] GPS error:", err.message);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10_000,
                timeout: 30_000,
            },
        );

        // Periodic send in case GPS fires less frequently than our interval
        intervalRef.current = setInterval(sendPosition, SEND_INTERVAL_MS);

        return () => {
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
            if (intervalRef.current !== null) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            ownGpsPosition.set(null);
        };
    }, [participant, ws]);
}
