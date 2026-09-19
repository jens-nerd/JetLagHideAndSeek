/**
 * Shared error handler for question submission / answer submission.
 *
 * Shows a context-aware toast and auto-leaves the session when the
 * backend reports 404 (session no longer exists).
 */
import { toast } from "react-toastify";
import { locale, t } from "@/i18n";
import { SessionNotFoundError, SessionFinishedError, NetworkError, ApiError } from "./session-api";
import { leaveSession } from "./session-context";

/**
 * Call this in the `catch` block of any `addQuestion` / `answerQuestion` call.
 *
 * It inspects the error type to display the most helpful message:
 *   - SessionNotFoundError → clears session state + notifies user
 *   - SessionFinishedError → tells user session is done
 *   - NetworkError         → offline / server down hint
 *   - ForbiddenError       → permission issue
 *   - 409 kategorie_gesperrt → Glücksrad blockt diese Kategorie gerade
 *   - Other ApiError       → server-side message
 *   - Unknown              → generic fallback
 */
export function handleSubmitError(error: unknown): void {
    if (error instanceof SessionNotFoundError) {
        leaveSession();
        toast.error("Session nicht mehr vorhanden — du wurdest automatisch abgemeldet.", {
            autoClose: 6000,
        });
        return;
    }

    if (error instanceof SessionFinishedError) {
        toast.error("Diese Session ist bereits beendet.");
        return;
    }

    if (error instanceof NetworkError) {
        toast.error("Server nicht erreichbar — prüfe deine Internetverbindung.");
        return;
    }

    // Die Kategorie war beim Absenden gesperrt. Die Karte ist im Wähler zwar
    // ausgeblendet, zwei Suchende können aber gleichzeitig tippen — dann kommt
    // die Abweisung trotzdem, und "kategorie_gesperrt" sagt niemandem etwas.
    if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.message === "kategorie_gesperrt"
    ) {
        toast.error(t("cards.lockedRejected", locale.get()));
        return;
    }

    if (error instanceof ApiError) {
        toast.error(error.message);
        return;
    }

    // Unknown / non-API error
    toast.error("Unbekannter Fehler — bitte versuche es erneut.");
}
