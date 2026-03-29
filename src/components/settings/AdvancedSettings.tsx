import { useStore } from "@nanostores/react";
import { toast } from "react-toastify";
import { locale, t, useT } from "@/i18n";
import {
    alwaysUsePastebin,
    animateMapMovements,
    autoSave,
    customInitPreference,
    hiderMode,
    hidingZone,
    highlightTrainLines,
    leafletMapContext,
    offlineMapsEnabled,
    pastebinApiKey,
    planningModeEnabled,
    questions,
    save,
    thunderforestApiKey,
    triggerLocalRefresh,
} from "@/lib/context";
import { loadHidingZone } from "@/lib/hiding-zone-loader";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LatitudeLongitude } from "@/components/LatLngPicker";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar-l";

import { SettingsRow } from "./SettingsRow";

interface AdvancedSettingsProps {
    onSelectOpen?: (open: boolean) => void;
}

export function AdvancedSettings({ onSelectOpen }: AdvancedSettingsProps) {
    const tr = useT();
    const $animateMapMovements = useStore(animateMapMovements);
    const $highlightTrainLines = useStore(highlightTrainLines);
    const $thunderforestApiKey = useStore(thunderforestApiKey);
    const $pastebinApiKey = useStore(pastebinApiKey);
    const $alwaysUsePastebin = useStore(alwaysUsePastebin);
    const $planningMode = useStore(planningModeEnabled);
    const $autoSave = useStore(autoSave);
    const $customInitPref = useStore(customInitPreference);
    const $hiderMode = useStore(hiderMode);
    const $hidingZone = useStore(hidingZone);
    const $offlineMapsEnabled = useStore(offlineMapsEnabled);
    useStore(triggerLocalRefresh);

    return (
        <div style={{ padding: "0 16px" }}>
            {/* ── Kartenbewegungen animieren ── */}
            <SettingsRow title={tr("options.animateMapMovements")}>
                <Switch
                    checked={$animateMapMovements}
                    onCheckedChange={() =>
                        animateMapMovements.set(!$animateMapMovements)
                    }
                />
            </SettingsRow>

            {/* ── Bahnlinien hervorheben ── */}
            <SettingsRow title={tr("options.highlightTrainLines")}>
                <Switch
                    checked={$highlightTrainLines}
                    onCheckedChange={() =>
                        highlightTrainLines.set(!$highlightTrainLines)
                    }
                />
            </SettingsRow>

            {/* ── Thunderforest API key (conditional) ── */}
            {$highlightTrainLines && (
                <div style={{ padding: "8px 0 14px", borderBottom: "1px solid rgba(245,245,240,0.08)" }}>
                    <div style={{ color: "#99A1AF", fontSize: 13, marginBottom: 6 }}>
                        {tr("options.thunderforestApiKey")}
                    </div>
                    <Input
                        type="text"
                        value={$thunderforestApiKey}
                        onChange={(e) => thunderforestApiKey.set(e.target.value)}
                        placeholder={tr("options.thunderforestApiKey")}
                    />
                    <p style={{ color: "#6B7280", fontSize: 11, marginTop: 4 }}>
                        {tr("options.thunderforestApiKeyHelp1")}{" "}
                        <a
                            href="https://manage.thunderforest.com/users/sign_up?price=hobby-project-usd"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#60A5FA" }}
                        >
                            {tr("options.thunderforestApiKeyHere")}
                        </a>
                        . {tr("options.thunderforestApiKeyHelp2")}
                    </p>
                </div>
            )}

            {/* ── Automatisch speichern ── */}
            <SettingsRow title={tr("options.autoSave")}>
                <Switch
                    checked={$autoSave}
                    onCheckedChange={() => autoSave.set(!$autoSave)}
                />
            </SettingsRow>

            {/* ── Versteckzone kopieren ── */}
            <SettingsRow title={tr("settings.copyZone")}>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        if (!navigator?.clipboard) {
                            return toast.error(t("toast.options.clipboardNotSupported", locale.get()));
                        }
                        navigator.clipboard.writeText(JSON.stringify($hidingZone));
                        toast.success(t("toast.options.hidingZoneCopied", locale.get()), {
                            autoClose: 2000,
                        });
                    }}
                >
                    {tr("settings.copyButton")}
                </Button>
            </SettingsRow>

            {/* ── Versteckzone einfügen ── */}
            <SettingsRow title={tr("settings.pasteZone")}>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        if (!navigator?.clipboard) {
                            return toast.error(t("toast.options.clipboardNotSupported", locale.get()));
                        }
                        navigator.clipboard.readText().then(loadHidingZone);
                    }}
                >
                    {tr("settings.pasteButton")}
                </Button>
            </SettingsRow>

            {/* ── Offline-Karten ── */}
            <SettingsRow title={tr("settings.offlineMaps")}>
                <Switch
                    checked={$offlineMapsEnabled}
                    onCheckedChange={(v) => offlineMapsEnabled.set(v)}
                />
            </SettingsRow>

        </div>
    );
}
