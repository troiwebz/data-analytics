# Claude-written specifics

The category template says what you do. Claude writes the 2-4 bullets in the
middle that prove you read *that* thread.

```
Hi @buyer,                                     ← template
We do this every week. We run SEO for…         ← template

- Submissions to UAE directories that          ┐
  actually index, plus the UK set separately   │
- Existing listings audited for duplicate      ├ Claude
  and mismatched NAP before anything new       │
- Arabic and English name variants handled     ┘

Samples and past results on request. PMing you now.   ← template
```

## Setup

1. Get a key at <https://console.anthropic.com> → API keys.
2. Paste the current `apps-script/single-file/Code.gs` and redeploy
   (**Deploy → Manage deployments → ✏️ → New version**).
3. Extension **Settings → Claude → Anthropic API key** → paste → **Save key**.
   The extension sends it to Apps Script and immediately forgets it; the key is
   stored in Script Properties and only a masked hint (`sk-ant-api0…4f9c`) is
   ever read back. An extension ships its source to every machine it is
   installed on, so it must never hold the key itself.
   (Adding `ANTHROPIC_API_KEY` by hand in ⚙️ Project Settings works too.)
4. Send `/ai` to the bot, or reopen Settings, to confirm it is on.

Optional properties: `ANTHROPIC_MODEL` (default `claude-opus-5`),
`AI_SPECIFICS` (`no` to disable without removing the key).

## Controls

| | |
|---|---|
| `/ai` | is it on, and which model |
| `/ai off` · `/ai on` | toggle without touching the key |
| `/ai claude-haiku-4-5` | change model |
| `/cost` | tokens and dollars spent today, and per lead |

## What it costs, and why it is small

Five things keep the bill down:

- **Claude writes only the bullets.** Greeting, offer and sign-off come from
  the template, so output is ~70 tokens per lead rather than ~400.
- **Leads are batched per poll** (up to 8), so the instructions are paid for
  once per poll, not once per lead.
- **The instructions are a cached prefix**, read at a tenth of the input price
  on every poll after the first.
- **`effort: "low"`** — short-form writing from supplied text, not reasoning.
- **Results are stored on the lead**, so a thread is never sent twice.
- **Backfill and "Load older threads" do not call Claude** — loading two days
  of history would mean dozens of calls for threads you may never answer.
  Those get the built-in rules; press **Rebuild drafts** to fill any of them in
  with Claude later.

Roughly **$0.002-0.003 per lead on Opus 5**: about **$4/month at 50 leads a
day**. `claude-haiku-4-5` is about a fifth of that (~$0.70/month) if you want
it cheaper — one `/ai claude-haiku-4-5` away, and the model choice is yours.
`/cost` shows the real figure rather than this estimate.

## Guard rails

A prompt is a request, not a guarantee, so every returned bullet is checked in
Apps Script before it reaches a draft: em dashes, en dashes and bullet glyphs
are stripped; anything promising a guarantee, a discount, free work or a
ranking result is dropped; bullets outside 15-160 characters are dropped; at
most four survive.

If the key is missing, the API errors, the response will not parse, or every
bullet is rejected, the reply falls back to the built-in `specifics` rules.
Nothing blocks and no lead is lost.
