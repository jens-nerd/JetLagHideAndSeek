/**
 * SeekerMarkers — renders live seeker positions on the hider's map.
 *
 * Shows a red circle marker with the seeker's display name for each
 * connected seeker. Only renders when the current user is a hider.
 */
import { useStore } from "@nanostores/react";
import { CircleMarker, Tooltip } from "react-leaflet";

import { sessionParticipant, seekerPositions } from "@/lib/session-context";

export function SeekerMarkers() {
    const participant = useStore(sessionParticipant);
    const positions = useStore(seekerPositions);

    // Only the hider sees seeker markers
    if (!participant || participant.role !== "hider") return null;
    if (positions.length === 0) return null;

    return (
        <>
            {positions.map((seeker) => (
                <CircleMarker
                    key={seeker.id}
                    center={[seeker.lat, seeker.lng]}
                    radius={8}
                    pathOptions={{
                        color: "#E8323A",
                        fillColor: "#E8323A",
                        fillOpacity: 0.85,
                        weight: 2,
                    }}
                >
                    <Tooltip
                        permanent
                        direction="top"
                        offset={[0, -10]}
                        className="seeker-name-tooltip"
                    >
                        {seeker.displayName}
                    </Tooltip>
                </CircleMarker>
            ))}
        </>
    );
}
