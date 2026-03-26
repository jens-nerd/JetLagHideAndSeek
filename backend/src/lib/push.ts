interface PushMessage {
    to: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

/**
 * Send push notifications via the Expo Push API.
 * Filters out empty/null tokens and silently handles failures.
 */
export async function sendPushNotifications(
    tokens: (string | null | undefined)[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
): Promise<void> {
    const validTokens = tokens.filter(
        (t): t is string => typeof t === "string" && t.length > 0,
    );
    if (validTokens.length === 0) return;

    const messages: PushMessage[] = validTokens.map((token) => ({
        to: token,
        title,
        body,
        ...(data ? { data } : {}),
    }));

    try {
        await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(messages),
        });
    } catch (err) {
        console.error("Failed to send push notifications:", err);
    }
}
