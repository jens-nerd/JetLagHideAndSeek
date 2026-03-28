/**
 * Timer state atoms for Hiding Timer + Stopwatch.
 *
 * - hidingTimerDuration: selected duration in minutes (5-240, step 5)
 * - hidingTimerEnd: ISO timestamp when timer expires (null = not running)
 * - hidingStopwatchStart: ISO timestamp when stopwatch started (null = not running)
 */
import { persistentAtom } from "@nanostores/persistent";
import { atom } from "nanostores";

/** Selected timer duration in minutes (default 30) */
export const hidingTimerDuration = persistentAtom<number>(
    "hiding_timer_duration",
    30,
    { encode: JSON.stringify, decode: JSON.parse },
);

/** When the timer expires — null means timer is not active */
export const hidingTimerEnd = persistentAtom<string | null>(
    "hiding_timer_end",
    null,
    { encode: JSON.stringify, decode: JSON.parse },
);

/** When the stopwatch started (after timer expired) — null means not running */
export const hidingStopwatchStart = persistentAtom<string | null>(
    "hiding_stopwatch_start",
    null,
    { encode: JSON.stringify, decode: JSON.parse },
);

/** Start the hiding timer with the currently selected duration */
export function startHidingTimer(): void {
    const minutes = hidingTimerDuration.get();
    const end = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    hidingTimerEnd.set(end);
    hidingStopwatchStart.set(null);
}

/** Cancel the hiding timer (and stopwatch) */
export function cancelHidingTimer(): void {
    hidingTimerEnd.set(null);
    hidingStopwatchStart.set(null);
}

/** Start the stopwatch (called automatically when timer expires) */
export function startStopwatch(): void {
    hidingStopwatchStart.set(new Date().toISOString());
}
