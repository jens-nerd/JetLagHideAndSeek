"use client";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { PlacePicker } from "@/components/PlacePicker";
import { hiderAreaConfirmed, pendingRole } from "@/lib/session-context";

export function HiderAreaSearch() {
    const tr = useT();

    return (
        <div className="flex flex-col gap-3 py-2">
            <p className="text-sm font-semibold">{tr("area.title")}</p>
            <p className="text-xs text-muted-foreground">{tr("area.hint")}</p>
            <PlacePicker className="w-full" />
            <Button
                className="w-full"
                onClick={() => hiderAreaConfirmed.set(true)}
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
