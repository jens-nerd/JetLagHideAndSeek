/**
 * SeekerMarkers — renders live seeker positions on the map.
 *
 * - Hider: sees red circle markers with seeker names for all connected seekers
 * - Seeker: sees a blue circle marker for their own GPS position
 */
import { useStore } from "@nanostores/react";
import { CircleMarker, Tooltip } from "react-leaflet";

import { sessionParticipant, seekerPositions, ownGpsPosition } from "@/lib/session-context";

export function SeekerMarkers() {
    const participant = useStore(sessionParticipant);
    const positions = useStore(seekerPositions);
    const ownPos = useStore(ownGpsPosition);

    if (!participant) return null;

    return (
        <>
            {/* Hider sees all seeker positions */}
            {participant.role === "hider" &&
                positions.map((seeker) => (
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

            {/* Seeker sees their own GPS position */}
            {participant.role === "seeker" && ownPos && (
                <CircleMarker
                    center={[ownPos.lat, ownPos.lng]}
                    radius={8}
                    pathOptions={{
                        color: "#2A81CB",
                        fillColor: "#2A81CB",
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
                        Mein Standort
                    </Tooltip>
                </CircleMarker>
            )}
        </>
    );
}
