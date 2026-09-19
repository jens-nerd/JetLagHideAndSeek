import { useStore } from "@nanostores/react";
import { useState } from "react";
import { toast } from "react-toastify";

import { locale, t, useT } from "@/i18n";
import {
    autoZoom,
    defaultUnit,
    hidingZone,
    notificationsEnabled,
    offlineMapsEnabled,
    soundEnabled,
} from "@/lib/context";
import { kartenmechanikSchalten } from "@/lib/cards-api";
import { activeCurses, cardsEnabled } from "@/lib/deck-context";
import { loadHidingZone } from "@/lib/hiding-zone-loader";
import { sessionCode, sessionParticipant } from "@/lib/session-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { UnitSelect } from "@/components/UnitSelect";

import { SessionCard } from "./SessionCard";
import { SettingsRow } from "./SettingsRow";

interface GeneralSettingsProps {
    onSelectOpen?: (open: boolean) => void;
}

export function GeneralSettings({ onSelectOpen }: GeneralSettingsProps) {
    const tr = useT();
    const $autoZoom = useStore(autoZoom);
    const $soundEnabled = useStore(soundEnabled);
    const $notificationsEnabled = useStore(notificationsEnabled);
    const $offlineMapsEnabled = useStore(offlineMapsEnabled);
    const $defaultUnit = useStore(defaultUnit);
    const $hidingZone = useStore(hidingZone);
    const $participant = useStore(sessionParticipant);
    const $sessionCode = useStore(sessionCode);
    const $cardsEnabled = useStore(cardsEnabled);
    const $activeCurses = useStore(activeCurses);
    const [kartenLaufend, setKartenLaufend] = useState(false);

    const darfKartenSchalten =
        $participant?.role === "hider" && $sessionCode !== null;

    async function kartenSchalten(wert: boolean) {
        if (!$sessionCode || !$participant?.token || kartenLaufend) return;
        if (!wert && $activeCurses.length > 0) {
            if (!window.confirm(tr("settings.cardsConfirmOff"))) return;
        }
        setKartenLaufend(true);
        try {
            await kartenmechanikSchalten($sessionCode, $participant.token, wert);
            // cardsEnabled kommt über das cards_toggled-Ereignis zurück.
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setKartenLaufend(false);
        }
    }

    return (
        <div style={{ padding: "0 16px" }}>
            <SessionCard />

            {/* ── Sprache ── */}
            <SettingsRow
                title={tr("settings.language")}
                description={tr("settings.languageDesc")}
            >
                <div style={{ display: "flex", gap: 4 }}>
                    <Button
                        size="sm"
                        variant={locale.get() === "de" ? "default" : "outline"}
                        onClick={() => locale.set("de")}
                    >
                        DE
                    </Button>
                    <Button
                        size="sm"
                        variant={locale.get() === "en" ? "default" : "outline"}
                        onClick={() => locale.set("en")}
                    >
                        EN
                    </Button>
                </div>
            </SettingsRow>

            {/* ── Standardeinheit ── */}
            <SettingsRow
                title={tr("settings.defaultUnit")}
                description={tr("settings.defaultUnitDesc")}
            >
                <UnitSelect
                    unit={$defaultUnit}
                    onChange={defaultUnit.set}
                    onOpenChange={onSelectOpen}
                />
            </SettingsRow>

            {/* ── Automatisch zoomen ── */}
            <SettingsRow
                title={tr("settings.autoZoom")}
                description={tr("settings.autoZoomDesc")}
            >
                <Switch
                    checked={$autoZoom}
                    onCheckedChange={(v) => autoZoom.set(v)}
                />
            </SettingsRow>

            {/* ── Ton ── */}
            <SettingsRow
                title={tr("settings.sound")}
                description={tr("settings.soundDesc")}
            >
                <Switch
                    checked={$soundEnabled}
                    onCheckedChange={(v) => soundEnabled.set(v)}
                />
            </SettingsRow>

            {/* ── Benachrichtigungen (UI placeholder) ── */}
            <SettingsRow
                title={tr("settings.notifications")}
                description={tr("settings.notificationsDesc")}
            >
                <Switch
                    checked={$notificationsEnabled}
                    onCheckedChange={(v) => notificationsEnabled.set(v)}
                />
            </SettingsRow>

            {/* ── Kartenmechanik (nur der Versteckende, nur in einer Sitzung) ── */}
            {darfKartenSchalten ? (
                <SettingsRow
                    title={tr("settings.cards")}
                    description={tr("settings.cardsDesc")}
                >
                    <Switch
                        checked={$cardsEnabled}
                        disabled={kartenLaufend}
                        onCheckedChange={(v) => void kartenSchalten(v)}
                    />
                </SettingsRow>
            ) : null}

        </div>
    );
}
