import _ from "lodash";

import { GEOCODER_API } from "./constants";
import { convertToLatLong } from "./geo";
import type { OpenStreetMap } from "./types";

export interface GeocodeOptions {
    /** Maximale Trefferzahl, die Photon zurückgibt. */
    limit?: number;
    /** Breitengrad für die Nähe-Gewichtung (Kartenmitte). */
    lat?: number;
    /** Längengrad für die Nähe-Gewichtung (Kartenmitte). */
    lon?: number;
    /** Serverseitiger Tag-Filter, z. B. "place" für Ortschaften und Gebiete. */
    osmTag?: string;
}

/**
 * Baut die Photon-Anfrage-URL. Ausgelagert, damit beide Suchstellen
 * (PlacePicker im Spielgebiet, LocationCard im Spiel) dieselben Parameter
 * verwenden – und damit der URL-Bau testbar ist.
 */
export const buildGeocodeUrl = (
    address: string,
    language: string,
    options: GeocodeOptions = {},
) => {
    const params = new URLSearchParams({ lang: language, q: address });
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.lat !== undefined && options.lon !== undefined) {
        params.set("lat", String(options.lat));
        params.set("lon", String(options.lon));
    }
    if (options.osmTag) params.set("osm_tag", options.osmTag);
    return `${GEOCODER_API}?${params.toString()}`;
};

export const geocode = async (
    address: string,
    language: string,
    filter: boolean = true,
    options: GeocodeOptions = {},
) => {
    const features = (
        await (await fetch(buildGeocodeUrl(address, language, options))).json()
    ).features as OpenStreetMap[];

    features.forEach((feature) => {
        feature.geometry.coordinates = convertToLatLong(
            feature.geometry.coordinates as number[],
        );
        if (!feature.properties.extent) return;
        feature.properties.extent = [
            feature.properties.extent[1],
            feature.properties.extent[0],
            feature.properties.extent[3],
            feature.properties.extent[2],
        ];
    });

    return _.uniqBy(
        features.filter((feature) => {
            return filter ? feature.properties.osm_type === "R" : true;
        }),
        (feature) => feature.properties.osm_id,
    );
};
