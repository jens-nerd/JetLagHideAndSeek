import type { Units } from "@/maps/schema";
import { useT } from "@/i18n";

import { Select } from "./ui/select";

export const UnitSelect = ({
    unit,
    onChange,
    disabled,
    onOpenChange,
}: {
    unit: Units;
    onChange: (unit: Units) => void;
    disabled?: boolean;
    onOpenChange?: (open: boolean) => void;
}) => {
    const tr = useT();
    return (
        <Select
            trigger={tr("options.defaultUnit")}
            options={{
                miles: tr("unit.miles"),
                kilometers: tr("unit.kilometers"),
                meters: tr("unit.meters"),
            }}
            disabled={disabled}
            value={unit}
            onValueChange={onChange}
            onOpenChange={onOpenChange}
        />
    );
};
