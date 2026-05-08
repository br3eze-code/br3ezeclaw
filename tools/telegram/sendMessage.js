// tools/telegram/sendMessage.js
// Telegram Messaging Tool

/**
 * TOOL: telegram.sendMessage
 * Sends message to a Telegram chat or user
 */

const TELEGRAM_API = "https://api.telegram.org";

export async function sendMessage({ chatId, message, parseMode = "HTML" }) {
    if (!chatId || !message) {
        throw new Error("Missing chatId or message");
    }

    try {
        const res = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode
            })
        });

        const data = await res.json();

        if (!data.ok) {
            throw new Error(data.description || "Telegram send failed");
        }

        return {
            status: "sent",
            chatId,
            messageId: data.result.message_id
        };

    } catch (err) {
        throw new Error("telegram.sendMessage failed: " + err.message);
    }
}