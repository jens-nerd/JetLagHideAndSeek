/**
 * PlayerMarkers — renders player position pins on the map.
 *
 * - Every player sees their own pin (Seeker=red, Hider=green), labeled "Ich"
 * - Hider additionally sees all Seeker positions as red pins with displayName
 * - GPS position (`ownGpsPosition`) is the sole source for the own marker
 * - Seeker positions are deduplicated by id before rendering
 */
import { useStore } from "@nanostores/react";
import { CircleMarker, Tooltip } from "react-leaflet";

import { sessionParticipant, seekerPositions, ownGpsPosition } from "@/lib/session-context";

const COLOR_SEEKER = "#E8323A";
const COLOR_HIDER = "#22C55E";

export function PlayerMarkers() {
    const participant = useStore(sessionParticipant);
    const positions = useStore(seekerPositions);
    const ownPos = useStore(ownGpsPosition);

    if (!participant) return null;

    const ownColor = participant.role === "hider" ? COLOR_HIDER : COLOR_SEEKER;

    // Deduplicate seeker positions by id (keep last occurrence)
    const uniqueSeekers = [...new Map(positions.map((s) => [s.id, s])).values()];

    return (
        <>
            {/* Own position pin (both roles) */}
            {ownPos && (
                <CircleMarker
                    center={[ownPos.lat, ownPos.lng]}
                    radius={8}
                    pathOptions={{
                        color: ownColor,
                        fillColor: ownColor,
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
                        Ich
                    </Tooltip>
                </CircleMarker>
            )}

            {/* Hider sees all seeker positions */}
            {participant.role === "hider" &&
                uniqueSeekers.map((seeker) => (
                    <CircleMarker
                        key={seeker.id}
                        center={[seeker.lat, seeker.lng]}
                        radius={8}
                        pathOptions={{
                            color: COLOR_SEEKER,
                            fillColor: COLOR_SEEKER,
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
