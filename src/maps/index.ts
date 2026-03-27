import * as turf from "@turf/turf";
import type { Feature, FeatureCollection } from "geojson";

import { safeUnion } from "./geo-utils";
import {
    adjustPerMatching,
    hiderifyMatching,
    matchingPlanningPolygon,
} from "./questions/matching";
import {
    adjustPerMeasuring,
    hiderifyMeasuring,
    measuringPlanningPolygon,
} from "./questions/measuring";
import {
    adjustPerRadius,
    hiderifyRadius,
    radiusPlanningPolygon,
} from "./questions/radius";
import {
    adjustPerTentacle,
    hiderifyTentacles,
    tentaclesPlanningPolygon,
} from "./questions/tentacles";
import {
    adjustPerThermometer,
    hiderifyThermometer,
    thermometerPlanningPolygon,
} from "./questions/thermometer";
import type { Question, Questions } from "./schema";

export * from "./geo-utils";

export const hiderifyQuestion = async (question: Question) => {
    // Photo questions have no geo computation — pass through unchanged.
    if (question.id === "photo") return question;

    if (question.data.drag) {
        switch (question.id) {
            case "radius":
                question.data = hiderifyRadius(question.data);
                break;
            case "thermometer":
                question.data = await hiderifyThermometer(question.data);
                break;
            case "tentacles":
                question.data = await hiderifyTentacles(question.data);
                break;
            case "matching":
                question.data = await hiderifyMatching(question.data);
                break;
            case "measuring":
                question.data = await hiderifyMeasuring(question.data);
                break;
        }
    }

    return question;
};

export const determinePlanningPolygon = async (
    question: Question,
    planningModeEnabled: boolean,
) => {
    if (planningModeEnabled && question.data.drag) {
        switch (question.id) {
            case "radius":
                return radiusPlanningPolygon(question.data);
            case "thermometer":
                return thermometerPlanningPolygon(question.data);
            case "tentacles":
                return tentaclesPlanningPolygon(question.data);
            case "matching":
                return matchingPlanningPolygon(question.data);
            case "measuring":
                return measuringPlanningPolygon(question.data);
        }
    }
};

export async function adjustMapGeoDataForQuestion(
    question: any,
    mapGeoData: any,
) {
    // Shortcut: if the hider's answer includes a pre-computed GeoJSON
    // result, intersect it with the current map boundary directly.
    // This avoids re-querying Overpass (which may fail or return different
    // data) and guarantees the restriction survives page reloads.
    if (question?.data?.computedGeoJSON) {
        try {
            const precomputed = question.data.computedGeoJSON;
            const feature =
                precomputed.type === "FeatureCollection"
                    ? safeUnion(precomputed)
                    : precomputed;
            if (feature) {
                const result = turf.intersect(
                    turf.featureCollection([safeUnion(mapGeoData), feature]),
                );
                if (result) {
                    return { type: "FeatureCollection", features: [result] };
                }
            }
        } catch {
            // Fall through to the regular per-type logic
        }
    }

    try {
        switch (question?.id) {
            case "radius":
                return await adjustPerRadius(question.data, mapGeoData);
            case "thermometer":
                return await adjustPerThermometer(question.data, mapGeoData);
            case "tentacles":
                if (question.data.location === false) {
                    return adjustPerRadius(
                        { ...question.data, within: false },
                        mapGeoData,
                    );
                }
                return await adjustPerTentacle(question.data, mapGeoData);
            case "matching":
                return await adjustPerMatching(question.data, mapGeoData);
            case "measuring":
                return await adjustPerMeasuring(question.data, mapGeoData);
            default:
                return mapGeoData;
        }
    } catch (err) {
        console.error(
            `[adjustMapGeoDataForQuestion] Failed for question type="${question?.id}":`,
            err,
        );
        return mapGeoData;
    }
}

export async function applyQuestionsToMapGeoData(
    questions: Questions,
    mapGeoData: any,
    planningModeEnabled: boolean,
    planningModeCallback?: (
        polygon: FeatureCollection | Feature,
        question: any,
    ) => void,
): Promise<any> {
    // ── Shortcut: if the last question carries a cumulative GeoJSON from
    // the mobile hider, use it directly as the final map state.  This
    // avoids algorithm divergence (ArcGIS vs Turf) between web and mobile.
    const lastWithCumulative = [...questions]
        .reverse()
        .find((q) => !q.data.drag && (q.data as any).cumulativeGeoJSON);
    if (lastWithCumulative) {
        const cumulative = (lastWithCumulative.data as any).cumulativeGeoJSON;
        const result =
            cumulative.type === "FeatureCollection"
                ? cumulative
                : { type: "FeatureCollection", features: [cumulative] };

        // Still emit planning polygons for pending questions
        if (planningModeCallback) {
            for (const question of questions) {
                const planningPolygon = await determinePlanningPolygon(
                    question,
                    planningModeEnabled,
                );
                if (planningPolygon) {
                    planningModeCallback(planningPolygon, question);
                }
            }
        }
        return result;
    }

    for (const question of questions) {
        if (planningModeCallback) {
            const planningPolygon = await determinePlanningPolygon(
                question,
                planningModeEnabled,
            );
            if (planningPolygon) {
                planningModeCallback(planningPolygon, question);
            }
        }
        if (planningModeEnabled && question.data.drag) {
            continue;
        }

        mapGeoData = await adjustMapGeoDataForQuestion(question, mapGeoData);

        if (mapGeoData == null) {
            console.error("[applyQuestions] adjustMapGeoDataForQuestion returned null/undefined for", question?.id);
            // Can't continue — bail out with whatever we had
            return { type: "FeatureCollection", features: [] };
        }

        if (mapGeoData.type !== "FeatureCollection") {
            mapGeoData = {
                type: "FeatureCollection",
                features: [mapGeoData],
            };
        }
    }
    return mapGeoData;
}
