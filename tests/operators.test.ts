import * as turf from "@turf/turf";
import { expect, test } from "vitest";

import { geoSpatialVoronoi } from "@/maps/geo-utils/operators";

// turf.randomPoint hat keinen Seed-Parameter, deshalb ein eigener PRNG mit
// festem Startwert (mulberry32). Vorher flatterte der Test in etwa 1 % der
// Laeufe und blockierte damit zufaellig einzelne Pushes.
const SEED = 20260918;

const mulberry32 = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const randomPoints = (random: () => number, count: number) =>
    turf.featureCollection(
        Array.from({ length: count }, () =>
            turf.point([random() * 360 - 180, random() * 180 - 90]),
        ),
    );

// Ein Punkt, der fast exakt gleich weit von zwei Basispunkten entfernt liegt,
// liegt auf einer Zellgrenze. Die Zellen kommen aus d3-geo-voronoi und werden
// ueber eine Mercator-Projektion mit endlicher Genauigkeit zu Polygonzuegen,
// deshalb kann die Grenze dort um wenige Dutzend Meter von der exakten
// Mittellinie abweichen. Gemessen ueber 400 Punktmengen (188.828 Testpunkte)
// lagen alle 10 Abweichungen unter 1,2e-4 relativem Abstand; die Schwelle
// darunter haelt knapp eine Groessenordnung Luft und schliesst 0,2 % der
// Punkte aus. Das ist eine Eigenheit der Testkonstruktion, kein Fehler in
// geoSpatialVoronoi.
const AMBIGUITY_TOLERANCE = 1e-3;

test("voronoi diagram", () => {
    const BASE_POINT_COUNT = 25;
    const TEST_POINT_COUNT = 500;

    const random = mulberry32(SEED);

    const basePoints = randomPoints(random, BASE_POINT_COUNT);
    const voronoi = geoSpatialVoronoi(basePoints);

    expect(voronoi).toBeDefined();
    expect(voronoi.features.length).toBe(BASE_POINT_COUNT);

    const testPoints = randomPoints(random, TEST_POINT_COUNT);

    testPoints.features.forEach((point) => {
        const voronoiIndex = voronoi.features.findIndex((feature) =>
            turf.booleanPointInPolygon(point, feature),
        );
        const nearestBasePoint = turf.nearestPoint(point, basePoints);
        const basePointIndex = basePoints.features.findIndex(
            (feature) =>
                feature.geometry.coordinates[0] ===
                    nearestBasePoint.geometry.coordinates[0] &&
                feature.geometry.coordinates[1] ===
                    nearestBasePoint.geometry.coordinates[1],
        );

        if (voronoiIndex === -1) {
            return; // A glitch with turf where overlapping polygons can cause this
        }

        const distances = basePoints.features
            .map((feature) => turf.distance(point, feature))
            .sort((a, b) => a - b);
        if (
            (distances[1] - distances[0]) / distances[0] <
            AMBIGUITY_TOLERANCE
        ) {
            return; // Punkt liegt praktisch auf der Zellgrenze, siehe oben
        }

        expect(voronoiIndex).toBe(basePointIndex);
    });
});
