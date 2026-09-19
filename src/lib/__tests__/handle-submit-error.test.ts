/**
 * Prüft, dass der Fehlerbehandler die Abweisung des Glücksrads erkennt und
 * nicht die rohe Serverkennung anzeigt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("react-toastify", () => ({ toast: toasts }));
vi.mock("../session-context", () => ({ leaveSession: vi.fn() }));

import { handleSubmitError } from "../handle-submit-error";
import { ApiError } from "../session-api";

describe("handleSubmitError", () => {
    beforeEach(() => {
        toasts.error.mockClear();
    });

    it("sagt bei einer gesperrten Kategorie, was los ist", () => {
        handleSubmitError(new ApiError("kategorie_gesperrt", 409, "HTTP_409"));

        const text = toasts.error.mock.calls[0][0] as string;
        expect(text).not.toContain("kategorie_gesperrt");
        expect(text).toContain("gesperrt");
    });

    it("reicht andere Serverfehler unverändert durch", () => {
        handleSubmitError(new ApiError("Konflikt", 409, "HTTP_409"));

        expect(toasts.error).toHaveBeenCalledWith("Konflikt");
    });
});
