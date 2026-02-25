import { useT } from "@/i18n";
import { pendingRole } from "@/lib/session-context";
import { Button } from "@/components/ui/button";

/**
 * Onboarding role-selection screen shown in the left panel when the user
 * has no active session. The map is already visible and interactive behind it.
 */
export function RoleSelection() {
    const tr = useT();

    return (
        <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">{tr("role.chooseRole")}</p>
            <Button
                className="w-full h-12 text-base font-semibold"
                onClick={() => pendingRole.set("hider")}
            >
                {tr("role.iAmHider")}
            </Button>
            <p className="text-xs text-muted-foreground -mt-1 px-1">
                {tr("role.hiderDesc")}
            </p>
            <Button
                variant="outline"
                className="w-full h-12 text-base font-semibold mt-1"
                onClick={() => pendingRole.set("seeker")}
            >
                {tr("role.iAmSeeker")}
            </Button>
            <p className="text-xs text-muted-foreground -mt-1 px-1">
                {tr("role.seekerDesc")}
            </p>
        </div>
    );
}
