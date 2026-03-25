/**
 * BottomSheetPanel — renders the bottom sheet with two tabs:
 *   1. "Fragen" — session questions (SessionManager)
 *   2. "Versteckzonen" — hiding zone configuration (ZoneSidebar)
 *
 * Onboarding flow (role selection, area search) is now handled by
 * CreateSessionOverlay. This component only shows the SessionManager once
 * the user is in an active session.
 */
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { BottomSheetTab } from "@/components/ui/BottomSheet";
import { OptionDrawersInline } from "@/components/OptionDrawers";
import { sessionCode, sessionParticipant } from "@/lib/session-context";
import { bottomSheetState, pickerOpen } from "@/lib/bottom-sheet-state";
import { useSessionMapSync } from "@/hooks/useSessionMapSync";
import { useSessionInit } from "@/hooks/useSessionInit";
import { useMapLocationSync } from "@/hooks/useMapLocationSync";
import { useSessionWebSocket } from "@/hooks/useSessionWebSocket";
import { useGpsTracking } from "@/hooks/useGpsTracking";

import { SessionManager } from "./session/SessionManager";
import { QuestionPickerSheet } from "./session/QuestionPickerSheet";
import { ZoneSidebar } from "./ZoneSidebar";

const TABS: BottomSheetTab[] = [
    { id: "fragen", label: "Fragen" },
    { id: "zonen", label: "Versteckzonen" },
];

export const BottomSheetPanel = () => {
    const [activeTab, setActiveTab] = useState("fragen");

    const tr = useT();

    useSessionMapSync();
    useSessionInit();
    useMapLocationSync();
    useGpsTracking();

    const $participant = useStore(sessionParticipant);
    const $code = useStore(sessionCode);

    // WS hook lives here (always mounted) so the connection survives sheet collapse.
    // Both hiders and seekers need a live WS connection while in a session.
    useSessionWebSocket(
        $participant && $code
            ? { code: $code, token: $participant.token }
            : { code: "", token: "" },
    );

    const inSession = $participant !== null;

    // Collapse sheet for both roles when in an active session —
    // session content is handled by QuestionPickerSheet (opened via FRAGEN button).
    useEffect(() => {
        if (inSession) bottomSheetState.set("collapsed");
    }, [inSession]);

    function handleTabChange(tabId: string) {
        setActiveTab(tabId);
    }

    return (
        <>
            <BottomSheet
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                onSettingsClick={() => {
                    setActiveTab("settings");
                    if (bottomSheetState.get() === "collapsed") bottomSheetState.set("default");
                }}
            >
                {/* Both tabs stay mounted to preserve map layers & state */}
                <div style={{ display: activeTab === "fragen" ? "block" : "none" }}>
                    <div className="px-3 py-2">
                        {$participant ? <SessionManager /> : null}
                    </div>
                </div>
                <div style={{ display: activeTab === "zonen" ? "block" : "none" }}>
                    <ZoneSidebar />
                </div>
                <div style={{ display: activeTab === "settings" ? "block" : "none" }}>
                    <OptionDrawersInline />
                </div>
            </BottomSheet>
            <QuestionPickerSheet />
        </>
    );
};
