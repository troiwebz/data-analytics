# Telegram

Every new thread reaches your phone by itself, as two messages:

1. **the PM** - the card (score, category, budget, reply count, when it was
   posted), a link to the PM page with the recipient already filled in, a link
   to your BHW inbox, the subject line, and the PM itself in a block
2. **the public reply**, in a block of its own, with a link to the thread

The PM comes first because it is the one that actually gets sent. Settings ->
Telegram -> **What to send** can cut it to the PM alone, or the reply alone.

Tap a block on the Telegram mobile app and the whole thing is on your
clipboard. Open the thread or the PM page from the link above it, paste, send.

They are two messages rather than one so that neither is ever cut short by
Telegram's 4096-character limit, and so a tap copies the one you meant.

## Setting it up

Two values, one from each of two Telegram bots.

**The bot token**

1. Open Telegram, search **@BotFather**, start it.
2. Send `/newbot`. Give it any name, then a username ending in `bot`.
3. It replies with a token like `1234567890:AAH…`. Copy it.
4. Extension Settings -> Telegram -> **Bot token** -> **Save token**.

**Your chat id**

5. In Telegram, search **@userinfobot** and start it. It replies with your id,
   a number like `8812664414`.
6. Paste it into **Your chat id** and press **Save** at the bottom of Settings.

**Then**

7. Press **Send a test message**. Your phone should buzz.
8. Message your own new bot once (`/start`) if nothing arrives - Telegram will
   not let a bot message you until you have opened a chat with it.

## Where the token lives

In the same vault as the Claude key: kept out of the settings, held in both the
extension's storage and your Chrome profile, and never cleared by a reset.
Removing one secret leaves the other alone.

## What it does not need

No Apps Script, no Google Sheet, no server, no public URL. Chrome talks to
api.telegram.org directly, the same way it talks to Anthropic. The Google Sheet
settings are still there and still optional; they are only for keeping a shared
permanent record and for the old approve-from-Telegram buttons.

## Limits and failures

At most 6 threads are sent per check, with a note saying how many more are on
the dashboard - a quiet burst rather than 30 buzzes at once.

If Telegram is unreachable, or the token is wrong, the check carries on and the
lead is saved as normal. The reason appears in the log at the bottom of the
dashboard. A messaging failure never costs you a lead.

## Switching it off

Untick **Send new threads to Telegram** in Settings, or press **Remove** next to
the token. Everything else keeps working.
