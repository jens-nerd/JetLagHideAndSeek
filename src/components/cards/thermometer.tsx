import { useStore } from "@nanostores/react";
import { distance, point } from "@turf/turf";
import { Flame, Snowflake } from "lucide-react";
import { useT } from "@/i18n";

import { LatitudeLongitude } from "@/components/LatLngPicker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { defaultUnit } from "@/lib/context";
import {
    hiderMode,
    isLoading,
    questionModified,
    questions,
    triggerLocalRefresh,
} from "@/lib/context";
import { cn } from "@/lib/utils";
import type { ThermometerQuestion } from "@/maps/schema";

import { QuestionCard } from "./base";

export const ThermometerQuestionComponent = ({
    data,
    questionKey,
    sub,
    className,
    embedded = false,
}: {
    data: ThermometerQuestion;
    questionKey: number;
    sub?: string;
    className?: string;
    embedded?: boolean;
}) => {
    useStore(triggerLocalRefresh);
    const $hiderMode = useStore(hiderMode);
    const $questions = useStore(questions);
    const $isLoading = useStore(isLoading);
    const tr = useT();

    const $defaultUnit = useStore(defaultUnit);
    const DISTANCE_UNIT = $defaultUnit ?? "miles";

    const label = `Thermometer
    ${
        $questions
            .filter((q) => q.id === "thermometer")
            .map((q) => q.key)
            .indexOf(questionKey) + 1
    }`;

    const hasCoords =
        data.latA !== null &&
        data.lngA !== null &&
        data.latB !== null &&
        data.lngB !== null;

    const distanceValue = hasCoords
        ? distance(
              point([data.lngA!, data.latA!]),
              point([data.lngB!, data.latB!]),
              { units: DISTANCE_UNIT },
          )
        : null;

    const unitLabel =
        DISTANCE_UNIT === "meters"
            ? "Meters"
            : DISTANCE_UNIT === "kilometers"
              ? "KM"
              : "Miles";

    return (
        <QuestionCard
            questionKey={questionKey}
            label={label}
            sub={sub}
            className={className}
            collapsed={data.collapsed}
            setCollapsed={(collapsed) => {
                data.collapsed = collapsed;
            }}
            locked={!data.drag}
            setLocked={(locked) => questionModified((data.drag = !locked))}
            embedded={embedded}
        >
            <LatitudeLongitude
                latitude={data.latA}
                longitude={data.lngA}
                label={tr("thermometer.start")}
                colorName={data.colorA}
                onChange={(lat, lng) => {
                    if (lat !== null) data.latA = lat;
                    if (lng !== null) data.lngA = lng;
                    questionModified();
                }}
                disabled={!data.drag || $isLoading}
                compact={embedded}
            />

            <LatitudeLongitude
                latitude={data.latB}
                longitude={data.lngB}
                label={tr("thermometer.end")}
                colorName={data.colorB}
                onChange={(lat, lng) => {
                    if (lat !== null) data.latB = lat;
                    if (lng !== null) data.lngB = lng;
                    questionModified();
                }}
                disabled={!data.drag || $isLoading}
                compact={embedded}
            />

            {distanceValue !== null && (
                <div className="px-2 text-sm text-muted-foreground">
                    {tr("thermometer.distance")}:{" "}
                    <span className="font-medium text-foreground">
                        {distanceValue.toFixed(3)} {unitLabel}
                    </span>
                </div>
            )}

            <div className="flex gap-2 items-center p-2">
                <ToggleGroup
                    className="grow"
                    type="single"
                    value={data.warmer ? "warmer" : "colder"}
                    onValueChange={(value: "warmer" | "colder") =>
                        questionModified((data.warmer = value === "warmer"))
                    }
                    disabled={!!$hiderMode || !data.drag || $isLoading}
                >
                    <ToggleGroupItem color="red" value="colder" title="Colder" className="flex items-center justify-center">
                        <Snowflake className="h-5 w-5" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="warmer" title="Warmer" className="flex items-center justify-center">
                        <Flame className="h-5 w-5" />
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
        </QuestionCard>
    );
};
