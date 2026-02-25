"use client";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { PlacePicker } from "@/components/PlacePicker";
import { additionalMapGeoLocations, mapGeoLocation } from "@/lib/context";
import { hiderAreaConfirmed, pendingRole } from "@/lib/session-context";

export function HiderAreaSearch() {
    const tr = useT();

    function handleConfirm() {
        // PlacePicker adds selections to additionalMapGeoLocations, not mapGeoLocation.
        // Promote the selected area to the primary location so buildMapLocationFromContext()
        // picks it up correctly when creating the session.
        const additional = additionalMapGeoLocations.get();
        const selected = additional.find((x) => x.added);
        if (selected) {
            mapGeoLocation.set(selected.location);
            additionalMapGeoLocations.set([]);
        }
        hiderAreaConfirmed.set(true);
    }

    return (
        <div className="flex flex-col gap-3 py-2">
            <p className="text-sm font-semibold">{tr("area.title")}</p>
            <p className="text-xs text-muted-foreground">{tr("area.hint")}</p>
            <PlacePicker className="w-full" />
            <Button
                className="w-full"
                onClick={handleConfirm}
            >
                {tr("area.confirm")}
            </Button>
            <button
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => pendingRole.set(null)}
            >
                {tr("area.back")}
            </button>
        </div>
    );
}
