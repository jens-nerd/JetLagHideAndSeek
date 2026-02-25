"use client";
import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT, locale } from "@/i18n";
import { geocode } from "@/maps/api";
import type { OpenStreetMap } from "@/maps/api";
import { mapGeoLocation } from "@/lib/context";
import { hiderAreaConfirmed, pendingRole } from "@/lib/session-context";

export function HiderAreaSearch() {
    const tr = useT();
    const $locale = useStore(locale);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<OpenStreetMap[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<OpenStreetMap | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!query.trim()) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await geocode(query, $locale);
                setResults(res);
            } catch {
                setResults([]);
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, $locale]);

    function handleSelect(feature: OpenStreetMap) {
        setSelected(feature);
        setResults([]);
        setQuery("");
    }

    function handleConfirm() {
        if (!selected) return;
        mapGeoLocation.set(selected);
        hiderAreaConfirmed.set(true);
    }

    // Derive Leaflet bounds from the Photon extent array [minLat, minLng, maxLat, maxLng]
    const bounds: LatLngBoundsExpression | undefined = selected?.properties.extent
        ? [
              [selected.properties.extent[0], selected.properties.extent[1]],
              [selected.properties.extent[2], selected.properties.extent[3]],
          ]
        : undefined;

    const secondaryLabel = selected
        ? [selected.properties.state, selected.properties.country]
              .filter(Boolean)
              .join(", ")
        : "";

    return (
        <div className="flex flex-col gap-3 py-2">
            <p className="text-sm font-semibold">{tr("area.title")}</p>
            <p className="text-xs text-muted-foreground">{tr("area.hint")}</p>

            {/* Search input */}
            <Input
                placeholder={tr("area.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
            />

            {/* Searching indicator */}
            {searching && (
                <p className="text-xs text-muted-foreground">{tr("area.searching")}</p>
            )}

            {/* Results list */}
            {results.length > 0 && (
                <ul className="flex flex-col gap-0 max-h-40 overflow-y-auto border rounded-md bg-background">
                    {results.map((f) => {
                        const sub = [f.properties.state, f.properties.country]
                            .filter(Boolean)
                            .join(", ");
                        return (
                            <li key={f.properties.osm_id}>
                                <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                    onClick={() => handleSelect(f)}
                                >
                                    <span className="font-medium">{f.properties.name}</span>
                                    {sub && (
                                        <span className="text-muted-foreground ml-1 text-xs">
                                            {sub}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* No results */}
            {!searching && query.trim() && results.length === 0 && !selected && (
                <p className="text-xs text-muted-foreground">{tr("area.noResults")}</p>
            )}

            {/* Selected area name + mini-map preview */}
            {selected && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">
                        {selected.properties.name}
                        {secondaryLabel && (
                            <span className="text-xs text-muted-foreground ml-1">
                                {secondaryLabel}
                            </span>
                        )}
                    </p>
                    {bounds ? (
                        <MapContainer
                            key={selected.properties.osm_id}
                            bounds={bounds}
                            className="h-36 w-full rounded-md"
                            zoomControl={false}
                            dragging={false}
                            scrollWheelZoom={false}
                            touchZoom={false}
                            doubleClickZoom={false}
                            attributionControl={false}
                        >
                            <TileLayer url="https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" />
                        </MapContainer>
                    ) : (
                        <MapContainer
                            key={selected.properties.osm_id}
                            center={selected.geometry.coordinates}
                            zoom={8}
                            className="h-36 w-full rounded-md"
                            zoomControl={false}
                            dragging={false}
                            scrollWheelZoom={false}
                            touchZoom={false}
                            doubleClickZoom={false}
                            attributionControl={false}
                        >
                            <TileLayer url="https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" />
                        </MapContainer>
                    )}
                </div>
            )}

            {/* Confirm button */}
            <Button
                className="w-full"
                disabled={!selected}
                onClick={handleConfirm}
            >
                {tr("area.confirm")}
            </Button>

            {/* Back to role selection */}
            <button
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => pendingRole.set(null)}
            >
                {tr("area.back")}
            </button>
        </div>
    );
}
