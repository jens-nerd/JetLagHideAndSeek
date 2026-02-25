import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import React from "react";
import { toast } from "react-toastify";
import { locale, t, useT } from "@/i18n";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { SidebarMenuButton } from "@/components/ui/sidebar-l";
import { addQuestion, isLoading, leafletMapContext } from "@/lib/context";

export const AddQuestionDialog = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const $isLoading = useStore(isLoading);
    const [open, setOpen] = React.useState(false);
    const tr = useT();

    const runAddRadius = () => {
        const map = leafletMapContext.get();
        if (!map) return false;
        const center = map.getCenter();
        addQuestion({
            id: "radius",
            data: { lat: center.lat, lng: center.lng },
        });
        return true;
    };

    const runAddThermometer = () => {
        const map = leafletMapContext.get();
        if (!map) return false;
        const center = map.getCenter();
        const destination = turf.destination([center.lng, center.lat], 5, 90, {
            units: "miles",
        });

        addQuestion({
            id: "thermometer",
            data: {
                latA: center.lat,
                lngB: center.lng,
                latB: destination.geometry.coordinates[1],
                lngA: destination.geometry.coordinates[0],
            },
        });

        return true;
    };

    const runAddTentacles = () => {
        const map = leafletMapContext.get();
        if (!map) return false;
        const center = map.getCenter();
        addQuestion({
            id: "tentacles",
            data: { lat: center.lat, lng: center.lng },
        });
        return true;
    };

    const runAddMatching = () => {
        const map = leafletMapContext.get();
        if (!map) return false;
        const center = map.getCenter();
        addQuestion({
            id: "matching",
            data: { lat: center.lat, lng: center.lng },
        });
        return true;
    };

    const runAddMeasuring = () => {
        const map = leafletMapContext.get();
        if (!map) return false;
        const center = map.getCenter();
        addQuestion({
            id: "measuring",
            data: { lat: center.lat, lng: center.lng },
        });
        return true;
    };

    const runPasteQuestion = async () => {
        if (!navigator || !navigator.clipboard) {
            toast.error(t("addQuestion.clipboardNotSupported", locale.get()));
            return false;
        }

        try {
            await toast.promise(
                navigator.clipboard.readText().then((text) => {
                    const parsed = JSON.parse(text);
                    const question =
                        parsed &&
                        typeof parsed === "object" &&
                        !Array.isArray(parsed)
                            ? { ...parsed, key: Math.random() }
                            : parsed;

                    return addQuestion(question);
                }),
                {
                    pending: t("addQuestion.readingFromClipboard", locale.get()),
                    success: t("addQuestion.questionAdded", locale.get()),
                    error: t("addQuestion.noValidQuestion", locale.get()),
                },
                { autoClose: 1000 },
            );

            return true;
        } catch {
            return false;
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
                <DialogTitle>{tr("addQuestion.title")}</DialogTitle>
                <DialogDescription>
                    {tr("addQuestion.description")}
                </DialogDescription>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <SidebarMenuButton
                        onClick={() => {
                            if (runAddRadius()) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.addRadius")}
                    </SidebarMenuButton>
                    <SidebarMenuButton
                        onClick={() => {
                            if (runAddThermometer()) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.addThermometer")}
                    </SidebarMenuButton>
                    <SidebarMenuButton
                        onClick={() => {
                            if (runAddTentacles()) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.addTentacles")}
                    </SidebarMenuButton>
                    <SidebarMenuButton
                        onClick={() => {
                            if (runAddMatching()) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.addMatching")}
                    </SidebarMenuButton>
                    <SidebarMenuButton
                        onClick={() => {
                            if (runAddMeasuring()) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.addMeasuring")}
                    </SidebarMenuButton>
                    <SidebarMenuButton
                        onClick={async () => {
                            const ok = await runPasteQuestion();
                            if (ok) setOpen(false);
                        }}
                        disabled={$isLoading}
                    >
                        {tr("addQuestion.pasteQuestion")}
                    </SidebarMenuButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
