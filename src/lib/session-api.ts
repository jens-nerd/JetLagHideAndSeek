/**
 * Typed API client for the Hide & Seek backend.
 * Reads the backend URL from import.meta.env.PUBLIC_BACKEND_URL,
 * falling back to http://localhost:3001 for local development.
 */
import type {
    AddQuestionRequest,
    AddQuestionResponse,
    AnswerQuestionRequest,
    AnswerQuestionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    GetSessionResponse,
    JoinSessionRequest,
    JoinSessionResponse,
    UpdateMapLocationRequest,
} from "@hideandseek/shared";

const BASE_URL =
    (typeof import.meta !== "undefined" &&
        (import.meta as any).env?.PUBLIC_BACKEND_URL) ||
    "";

// ── Typed API errors ─────────────────────────────────────────────────────────

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Session does not exist (or was deleted / expired). */
export class SessionNotFoundError extends ApiError {
    constructor(message = "Session nicht gefunden") {
        super(message, 404, "SESSION_NOT_FOUND");
        this.name = "SessionNotFoundError";
    }
}

/** Session has finished — no more actions allowed. */
export class SessionFinishedError extends ApiError {
    constructor(message = "Session ist bereits beendet") {
        super(message, 410, "SESSION_FINISHED");
        this.name = "SessionFinishedError";
    }
}

/** Token invalid or wrong role. */
export class ForbiddenError extends ApiError {
    constructor(message = "Keine Berechtigung") {
        super(message, 403, "FORBIDDEN");
        this.name = "ForbiddenError";
    }
}

/** Network-level failure (offline, DNS, CORS, timeout). */
export class NetworkError extends ApiError {
    constructor(message = "Server nicht erreichbar — bist du online?") {
        super(message, 0, "NETWORK_ERROR");
        this.name = "NetworkError";
    }
}

// ── Error-to-German message mapping ──────────────────────────────────────────

const STATUS_MESSAGES: Record<number, string> = {
    400: "Ungültige Anfrage — bitte versuche es erneut.",
    403: "Keine Berechtigung für diese Aktion.",
    404: "Session nicht gefunden — wurde sie gelöscht oder ist abgelaufen?",
    409: "Konflikt — diese Aktion wurde bereits ausgeführt.",
    410: "Session ist bereits beendet.",
    429: "Zu viele Anfragen — bitte warte kurz.",
    500: "Serverfehler — bitte versuche es später erneut.",
    502: "Server nicht erreichbar — bitte versuche es später erneut.",
    503: "Server vorübergehend nicht verfügbar.",
};

function toTypedError(status: number, serverMessage?: string): ApiError {
    const msg = serverMessage || STATUS_MESSAGES[status] || `Serverfehler (${status})`;

    if (status === 404) return new SessionNotFoundError(msg);
    if (status === 410) return new SessionFinishedError(msg);
    if (status === 403) return new ForbiddenError(msg);
    return new ApiError(msg, status, `HTTP_${status}`);
}

// ── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(
    path: string,
    options: RequestInit & { token?: string } = {},
): Promise<T> {
    const { token, ...rest } = options;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { "x-participant-token": token } : {}),
        ...(rest.headers as Record<string, string> | undefined),
    };

    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${path}`, { ...rest, headers });
    } catch {
        // fetch itself failed → network problem
        throw new NetworkError();
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw toTypedError(res.status, (body as any).error);
    }

    return res.json() as Promise<T>;
}

// ── Session endpoints ─────────────────────────────────────────────────────────

export function createSession(
    body: CreateSessionRequest,
): Promise<CreateSessionResponse> {
    return apiFetch("/api/sessions", { method: "POST", body: JSON.stringify(body) });
}

export function getSession(code: string): Promise<GetSessionResponse> {
    return apiFetch(`/api/sessions/${code}`);
}

export function joinSession(
    code: string,
    body: JoinSessionRequest,
): Promise<JoinSessionResponse> {
    return apiFetch(`/api/sessions/${code}/join`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export function updateMapLocation(
    code: string,
    token: string,
    body: UpdateMapLocationRequest,
): Promise<{ ok: boolean }> {
    return apiFetch(`/api/sessions/${code}/map`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
    });
}

// ── Question endpoints ────────────────────────────────────────────────────────

export function addQuestion(
    code: string,
    token: string,
    body: AddQuestionRequest,
): Promise<AddQuestionResponse> {
    return apiFetch(`/api/sessions/${code}/questions`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
    });
}

export function answerQuestion(
    questionId: string,
    token: string,
    body: AnswerQuestionRequest,
): Promise<AnswerQuestionResponse> {
    return apiFetch(`/api/questions/${questionId}/answer`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
    });
}
