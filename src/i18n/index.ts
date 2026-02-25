import { persistentAtom } from "@nanostores/persistent";
import { useStore } from "@nanostores/react";

import { de } from "./de";
import { en } from "./en";
import type { TranslationKey } from "./de";

export type { TranslationKey };
export type { Translations } from "./de";
export type Locale = "de" | "en";

const translations = { de, en } as const;

/**
 * Persisted language atom – defaults to German.
 * Follows the exact same pattern as all other atoms in src/lib/context.ts.
 */
export const locale = persistentAtom<Locale>("locale", "de", {
    encode: (v) => v,
    decode: (v): Locale => (v === "en" ? "en" : "de"),
});

/**
 * Translate a key for the given locale.
 * Falls back to German if the key is missing from the target locale.
 * Safe to call outside React components (e.g. in toast callbacks).
 *
 * @example
 *   toast.success(t("sqp.answerSent", locale.get()));
 */
export function t(key: TranslationKey, loc: Locale = "de"): string {
    return (translations[loc] as Record<string, string>)[key]
        ?? (translations["de"] as Record<string, string>)[key]
        ?? key;
}

/**
 * Like `t()` but replaces `{placeholder}` tokens with provided values.
 *
 * @example
 *   tFmt("zone.noTrainLineFound", locale.get(), { name: stationName })
 */
export function tFmt(
    key: TranslationKey,
    loc: Locale,
    vars: Record<string, string | number>,
): string {
    let result = t(key, loc);
    for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, String(v));
    }
    return result;
}

/**
 * React hook: subscribes to the locale atom and returns a bound `t()` function.
 * Use this inside React components.
 *
 * @example
 *   const tr = useT();
 *   return <button>{tr("options.save")}</button>;
 */
export function useT(): (key: TranslationKey) => string {
    const $locale = useStore(locale);
    return (key: TranslationKey) => t(key, $locale);
}

/**
 * React hook: like `useT()` but returns a `tFmt()` function for strings with
 * placeholders.
 *
 * @example
 *   const tr = useTFmt();
 *   return <p>{tr("zone.noTrainLineFound", { name: "Shinjuku" })}</p>;
 */
export function useTFmt(): (key: TranslationKey, vars: Record<string, string | number>) => string {
    const $locale = useStore(locale);
    return (key: TranslationKey, vars: Record<string, string | number>) =>
        tFmt(key, $locale, vars);
}
