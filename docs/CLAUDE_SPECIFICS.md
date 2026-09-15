# Claude writes the technical lines

Every reply and PM has the same shape:

    greeting          <- template
    2-3 technical     <- Claude, from the actual thread
    offer + sign-off  <- template

Only the middle is written by Claude. That is the part that has to prove you
read the post; the rest never changes, so paying a model to rewrite it would be
waste.

## Setting it up

1. Get a key at https://console.anthropic.com -> API keys. It starts `sk-ant-`.
2. Extension Settings -> Claude -> paste it -> **Save key**.

That is the whole setup. The key is checked against Anthropic before it is
stored, so a truncated paste is caught immediately.

## Where the key lives

In `chrome.storage.local` on this machine. Not in the extension folder, not in
git, not in Google, not on any server. It is sent to `api.anthropic.com` and
nowhere else. **Remove** in Settings deletes it.

This is safe here because the extension is loaded from your own folder on your
own Mac. If it were ever published to the Chrome Web Store the key would have to
move to a server, because a published extension's files are readable by anyone
who installs it.

## What it costs

Four things keep the bill small:

| | |
|---|---|
| Claude writes only the bullets | ~70 output tokens a lead instead of ~400 |
| All new threads go in one request | the instructions are paid for once per check, not once per lead |
| The instructions sit in a cached prefix | repeat checks read them at 10% of the input price |
| Results are stored on the lead | a thread is never paid for twice |

Models, per million tokens:

| Model | In | Out |
|---|---|---|
| `claude-opus-5` | $5 | $25 |
| `claude-sonnet-5` (default) | $2 | $10 |
| `claude-haiku-4-5` | $1 | $5 |

In practice a check that finds 3 threads costs a fraction of a cent on Sonnet.

## The spend limit

Settings -> Claude -> **Spend limit per day**. Default $0.50.

When the day's spend reaches it, Claude stands down and replies fall back to the
built-in rules in `src/specifics.js`. It resets at local midnight. Set it to 0
for no limit.

Today's spend is on the dashboard as a tile, and in Settings in full: leads,
calls, total, and cost per lead.

## When Claude is not available

No key, key removed, limit reached, network down, Anthropic returning an error:
in every case the poll carries on and the reply uses the built-in rules. Claude
never blocks a check and never loses a lead. The reason is written to the log at
the bottom of the dashboard.

## Rules enforced on the output

A prompt is a request, not a guarantee, so what comes back is filtered before it
reaches a draft:

- em dashes, en dashes and bullet glyphs are replaced with plain hyphens
- bullets under 16 or over 160 characters are dropped
- anything promising a guarantee, a discount, free work or a percentage off is dropped
- at most 3 bullets a lead

Then the normal compliance linter runs over the finished reply, same as always.
