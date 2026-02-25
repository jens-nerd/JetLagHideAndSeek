import { useStore } from "@nanostores/react";
import {
    ClipboardCopyIcon,
    ClipboardPasteIcon,
    EditIcon,
    LocateIcon,
    MapPin,
    X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { locale, t, useT } from "@/i18n";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { isLoading } from "@/lib/context";
import { cn } from "@/lib/utils";
import { determineName, geocode, ICON_COLORS } from "@/maps/api";

import { Button } from "./ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "./ui/command";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { SidebarMenuItem } from "./ui/sidebar-l";

const parseCoordinatesFromText = (
    text: string,
): { lat: number | null; lng: number | null } => {
    // Format: decimal degrees (e.g., 37.7749, -122.4194 or 37,7749, -122,4194)
    const decimalPattern = /(-?\d+[.,]\d+)\s*,\s*(-?\d+[.,]\d+)/;

    // Format: degrees, minutes, seconds (e.g., 37°46'26"N, 122°25'10"W)
    const dmsPattern =
        /(\d+)°\s*(\d+)['′]?\s*(?:(\d+(?:\.\d+)?)["″]?\s*)?([NS])[,\s]+(\d+)°\s*(\d+)['′]?\s*(?:(\d+(?:\.\d+)?)["″]?\s*)?([EW])/i;

    // Format: decimal degrees with cardinal directions (e.g., 48,89607° N, 9,09885° E or 48.89607° N, 9.09885° E)
    const decimalCardinalPattern =
        /(\d+[.,]\d+)°\s*([NS])\s*,\s*(\d+[.,]\d+)°\s*([EW])/i;

    const decimalMatch = text.match(decimalPattern);
    if (decimalMatch) {
        return {
            lat: parseFloat(decimalMatch[1].replace(",", ".")),
            lng: parseFloat(decimalMatch[2].replace(",", ".")),
        };
    }

    const dmsMatch = text.match(dmsPattern);
    if (dmsMatch) {
        let lat =
            parseInt(dmsMatch[1]) +
            parseInt(dmsMatch[2]) / 60 +
            (parseFloat(dmsMatch[3]) || 0) / 3600;
        let lng =
            parseInt(dmsMatch[5]) +
            parseInt(dmsMatch[6]) / 60 +
            (parseFloat(dmsMatch[7]) || 0) / 3600;

        if (dmsMatch[4].toUpperCase() === "S") lat = -lat;
        if (dmsMatch[8].toUpperCase() === "W") lng = -lng;

        return { lat, lng };
    }

    const decimalCardinalMatch = text.match(decimalCardinalPattern);
    if (decimalCardinalMatch) {
        let lat = parseFloat(decimalCardinalMatch[1].replace(",", "."));
        let lng = parseFloat(decimalCardinalMatch[3].replace(",", "."));

        if (decimalCardinalMatch[2].toUpperCase() === "S") lat = -lat;
        if (decimalCardinalMatch[4].toUpperCase() === "W") lng = -lng;

        return { lat, lng };
    }

    return { lat: null, lng: null };
};

const LatLngEditForm = ({
    latitude,
    longitude,
    onChange,
    disabled,
    compact = false,
}: {
    latitude: number;
    longitude: number;
    onChange: (lat: number | null, lng: number | null) => void;
    disabled?: boolean;
    compact?: boolean;
}) => {
    const [inputValue, setInputValue] = useState("");
    const debouncedValue = useDebounce<string>(inputValue);
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    /** Whether the search dropdown is open */
    const [searchOpen, setSearchOpen] = useState(false);
    /** Label of the last selected search result */
    const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

    useEffect(() => {
        if (debouncedValue === "") {
            setResults([]);
            return;
        } else {
            setLoading(true);
            setResults([]);
            geocode(debouncedValue, "en", false)
                .then((x) => {
                    setResults(x);
                    setLoading(false);
                })
                .catch(() => {
                    setError(true);
                    setLoading(false);
                });
        }
    }, [debouncedValue]);

    const _latlngLabels = results.map((r) => determineName(r));
    const _latlngLabelCounts: Record<string, number> = {};
    _latlngLabels.forEach((l) => {
        _latlngLabelCounts[l] = (_latlngLabelCounts[l] || 0) + 1;
    });
    const _latlngLabelByKey: Record<string, string> = {};
    const _latlngOcc: Record<string, number> = {};
    results.forEach((r) => {
        const key = `${r.properties.osm_id}${r.properties.name}`;
        const lbl = determineName(r);
        const idx = (_latlngOcc[lbl] = (_latlngOcc[lbl] || 0) + 1);
        _latlngLabelByKey[key] =
            _latlngLabelCounts[lbl] > 1 ? `${lbl} (${idx})` : lbl;
    });

    return (
        <>
            {/* ── Search field with collapse + selected-place chip ── */}
            <Command
                shouldFilter={false}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            >
                {/* Selected place chip */}
                {selectedLabel && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded text-xs mb-1"
                        style={{ backgroundColor: "#84BCDA" }}>
                        <MapPin className="h-3 w-3 shrink-0 text-white" />
                        <span className="flex-1 truncate font-medium text-white">{selectedLabel}</span>
                        <button
                            type="button"
                            onClick={() => setSelectedLabel(null)}
                            className="text-white/70 hover:text-white"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )}
                <CommandInput
                    placeholder={t("latlng.searchPlaceholder", locale.get())}
                    onFocus={() => setSearchOpen(true)}
                    onKeyUp={(x) => {
                        setInputValue(x.currentTarget.value);
                        if (x.currentTarget.value) setSearchOpen(true);
                    }}
                    disabled={disabled}
                />
                {searchOpen && (
                    <CommandList>
                        <CommandEmpty>
                            {loading
                                ? t("latlng.searching", locale.get())
                                : error
                                  ? t("latlng.loadError", locale.get())
                                  : t("latlng.noLocationFound", locale.get())}
                        </CommandEmpty>
                        <CommandGroup>
                            {results.map((result) => {
                                const _key = `${result.properties.osm_id}${result.properties.name}`;
                                const lbl = _latlngLabelByKey[_key] || determineName(result);
                                return (
                                    <CommandItem
                                        key={_key}
                                        onSelect={() => {
                                            const coords = result.geometry.coordinates;
                                            onChange(coords[0], coords[1]);
                                            setSelectedLabel(lbl);
                                            setSearchOpen(false);
                                            setInputValue("");
                                            setResults([]);
                                        }}
                                        className="cursor-pointer"
                                    >
                                        {lbl}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                )}
            </Command>

            {/* ── Lat/Lng inputs ── */}
            <div className={cn("flex gap-2 items-center", compact ? "w-full" : "flex-wrap")}>
                <Label className={cn("text-sm shrink-0", compact ? "w-8" : "min-w-10")}>Lat</Label>
                <Input
                    type="number"
                    className={cn(compact ? "flex-1 w-0 min-w-0 h-9 text-base" : "flex-1 min-w-0")}
                    value={Math.abs(latitude)}
                    min={0}
                    max={90}
                    onChange={(e) => {
                        if (isNaN(parseFloat(e.target.value))) return;
                        onChange(
                            parseFloat(e.target.value) *
                                (latitude !== 0 ? Math.sign(latitude) : -1),
                            null,
                        );
                    }}
                    disabled={disabled}
                />
                <Button
                    variant="outline"
                    className={cn(compact && "shrink-0 h-9 px-3")}
                    onClick={() => onChange(-latitude, null)}
                    disabled={disabled}
                >
                    {latitude > 0 ? "N" : "S"}
                </Button>
            </div>
            <div className={cn("flex gap-2 items-center", compact ? "w-full" : "flex-wrap")}>
                <Label className={cn("text-sm shrink-0", compact ? "w-8" : "min-w-10")}>Lng</Label>
                <Input
                    type="number"
                    className={cn(compact ? "flex-1 w-0 min-w-0 h-9 text-base" : "flex-1 min-w-0")}
                    value={Math.abs(longitude)}
                    min={0}
                    max={180}
                    onChange={(e) => {
                        if (isNaN(parseFloat(e.target.value))) return;
                        onChange(
                            null,
                            parseFloat(e.target.value) *
                                (longitude !== 0 ? Math.sign(longitude) : -1),
                        );
                    }}
                    disabled={disabled}
                />
                <Button
                    variant="outline"
                    className={cn(compact && "shrink-0 h-9 px-3")}
                    onClick={() => onChange(null, -longitude)}
                    disabled={disabled}
                >
                    {longitude > 0 ? "E" : "W"}
                </Button>
            </div>
        </>
    );
};

export const LatitudeLongitude = ({
    latitude,
    longitude,
    onChange,
    label = "Location",
    colorName,
    children,
    disabled,
    inlineEdit = false,
    compact = false,
}: {
    latitude: number;
    longitude: number;
    onChange: (lat: number | null, lng: number | null) => void;
    label?: string;
    colorName?: keyof typeof ICON_COLORS;
    className?: string;
    children?: React.ReactNode;
    disabled?: boolean;
    inlineEdit?: boolean;
    /**
     * Compact mode: no coloured SidebarMenuItem background, text-link action
     * buttons instead of icon buttons. Designed for embedding inside panels
     * with their own styling (e.g. the blue pending-question box).
     */
    compact?: boolean;
}) => {
    const $isLoading = useStore(isLoading);
    const tr = useT();

    const color = colorName ? ICON_COLORS[colorName] : "transparent";

    // Shared action handlers
    const handleLocate = () => {
        if (!navigator || !navigator.geolocation)
            return alert(t("latlng.geolocationNotSupported", locale.get()));
        isLoading.set(true);
        toast.promise(
            new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    maximumAge: 0,
                    enableHighAccuracy: true,
                });
            })
                .then((position) => {
                    onChange(position.coords.latitude, position.coords.longitude);
                })
                .finally(() => {
                    isLoading.set(false);
                }),
            {
                pending: t("latlng.fetchingLocation", locale.get()),
                success: t("latlng.locationFetched", locale.get()),
                error: t("latlng.couldNotFetchLocation", locale.get()),
            },
            { autoClose: 500 },
        );
    };

    const handlePaste = () => {
        if (!navigator || !navigator.clipboard) {
            toast.error(t("addQuestion.clipboardNotSupported", locale.get()));
            return;
        }
        isLoading.set(true);
        toast.promise(
            navigator.clipboard
                .readText()
                .then((text) => {
                    const coords = parseCoordinatesFromText(text);
                    if (coords.lat !== null && coords.lng !== null) {
                        onChange(coords.lat, coords.lng);
                        return;
                    }
                    throw new Error("Could not find coordinates in clipboard content");
                })
                .finally(() => {
                    isLoading.set(false);
                }),
            {
                pending: t("latlng.readingClipboard", locale.get()),
                success: t("latlng.coordinatesSet", locale.get()),
                error: t("latlng.noValidCoordinates", locale.get()),
            },
            { autoClose: 1000 },
        );
    };

    const handleCopy = () => {
        if (!navigator || !navigator.clipboard) {
            toast.error("Clipboard API not supported in your browser");
            return;
        }
        toast.promise(
            navigator.clipboard.writeText(
                `${Math.abs(latitude)}°${latitude > 0 ? "N" : "S"}, ${Math.abs(longitude)}°${longitude > 0 ? "E" : "W"}`,
            ),
            {
                pending: t("latlng.writingToClipboard", locale.get()),
                success: t("latlng.coordinatesCopied", locale.get()),
                error: t("latlng.errorCopying", locale.get()),
            },
            { autoClose: 1000 },
        );
    };

    // ── Compact mode ──────────────────────────────────────────────────────────
    if (compact) {
        return (
            <>
                <div className={cn("rounded-md p-2 space-y-1", $isLoading && "opacity-50")}
                    style={{ backgroundColor: color || undefined }}
                >
                    {/* Label + coordinates on one line */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        {label && <span className="font-bold text-sm text-white">{label}</span>}
                        <span className="tabular-nums text-xs font-medium text-white">
                            {Math.abs(latitude).toFixed(5)}°{latitude > 0 ? "N" : "S"}{" "}
                            {Math.abs(longitude).toFixed(5)}°{longitude > 0 ? "E" : "W"}
                        </span>
                    </div>
                    {/* Edit form always inline in compact mode */}
                    <LatLngEditForm
                        latitude={latitude}
                        longitude={longitude}
                        onChange={onChange}
                        disabled={disabled}
                        compact={true}
                    />
                    {/* Text-link action row */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <button
                            type="button"
                            onClick={handleLocate}
                            disabled={disabled}
                            className="underline font-medium text-white disabled:opacity-40 hover:text-white/80"
                        >
                            GPS
                        </button>
                        <button
                            type="button"
                            onClick={handlePaste}
                            disabled={disabled}
                            className="underline font-medium text-white disabled:opacity-40 hover:text-white/80"
                        >
                            {tr("latlng.fromClipboard")}
                        </button>
                    </div>
                </div>
                {children}
            </>
        );
    }

    // ── Standard (full) mode ──────────────────────────────────────────────────
    return (
        <>
            <SidebarMenuItem
                style={{
                    backgroundColor: color,
                }}
                className={cn(
                    "p-2 rounded-md space-y-1 mt-2",
                    $isLoading && "brightness-50",
                )}
            >
                {!inlineEdit && (
                    <div
                        className={cn(
                            "flex justify-between items-center",
                            $isLoading && "opacity-50",
                        )}
                        style={{
                            color: colorName === "gold" ? "black" : undefined,
                        }}
                    >
                        <div className="text-2xl font-semibold font-poppins">
                            {label}
                        </div>
                        <div className="tabular-nums text-right text-sm font-oxygen">
                            <div>
                                {Math.abs(latitude).toFixed(5)}
                                {"° "}
                                {latitude > 0 ? "N" : "S"}
                            </div>
                            <div>
                                {Math.abs(longitude).toFixed(5)}
                                {"° "}
                                {longitude > 0 ? "E" : "W"}
                            </div>
                        </div>
                    </div>
                )}

                <div
                    className={cn(
                        !inlineEdit &&
                            "flex justify-center gap-2 *:max-w-12 *:w-[20%]",
                    )}
                >
                    {inlineEdit ? (
                        <div className="flex flex-col gap-2 w-full mb-2">
                            <LatLngEditForm
                                latitude={latitude}
                                longitude={longitude}
                                onChange={onChange}
                                disabled={disabled}
                            />
                        </div>
                    ) : (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button
                                    disabled={disabled}
                                    variant="outline"
                                    title="Edit coordinates"
                                >
                                    <EditIcon />
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle className="text-2xl">
                                        {tr("latlng.updateLocation")} {label}
                                    </DialogTitle>
                                </DialogHeader>
                                <LatLngEditForm
                                    latitude={latitude}
                                    longitude={longitude}
                                    onChange={onChange}
                                    disabled={disabled}
                                />
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button>{tr("latlng.done")}</Button>
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                    <div
                        className={
                            inlineEdit
                                ? "flex justify-center gap-2"
                                : "contents"
                        }
                    >
                        <Button
                            variant="outline"
                            onClick={handleLocate}
                            disabled={disabled}
                            title="Set to current location"
                        >
                            <LocateIcon />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handlePaste}
                            disabled={disabled}
                            title="Paste coordinates from clipboard"
                        >
                            <ClipboardPasteIcon />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleCopy}
                            title="Copy coordinates to clipboard"
                        >
                            <ClipboardCopyIcon />
                        </Button>
                    </div>
                </div>
            </SidebarMenuItem>
            {children}
        </>
    );
};
