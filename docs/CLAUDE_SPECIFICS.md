# Claude writes the technical lines

Claude returns three lines per thread, strongest first. They are used twice,
differently:

**Public reply** - short on purpose.

    Hey @buyer,
    <line 1>  Core work for us.
    PM sent with the specifics.

One line proves you read the thread. The detail goes in the PM, where the other
freelancers reading the thread cannot see it and copy it.

**Private message** - common top, common bottom, this thread's middle.

    Hey buyer,
    Saw your thread on HAF: <link>      <- common
    How we would run it:
    <line 1> <line 2> <line 3>          <- Claude
    Your stated budget of $400 works.
    Portfolio and live samples...       <- common

Only the middle is written by Claude. The rest never changes in substance, so
paying a model to rewrite it would be waste.

## Why they do not look machine-written

Vocabulary is not what gives outreach away. Sameness is: the same skeleton every
time, the same three bullets under the same one-line intro, the same opener on
every message. So the shape moves, not just the words:

- the three lines are laid out as a dash list, as a numbered list, or as running
  prose, chosen per thread
- opener, lead-in and close each pick from several phrasings
- em dashes, en dashes and bullet glyphs are stripped from every render

All of it is seeded from the thread id, which means two things at once. Across
threads the output varies. Within one thread it is **stable**: pressing Rebuild
does not quietly reword a reply you already read and approved.

## Setting it up

1. Get a key at https://console.anthropic.com -> API keys. It starts `sk-ant-`.
2. Extension Settings -> Claude -> paste it -> **Save key**.

That is the whole setup. The key is checked against Anthropic before it is
stored, so a truncated paste is caught immediately.

## Where the key lives, and why it does not disappear

Two places at once:

- **`chrome.storage.local`** — the working copy, belonging to this installed
  extension.
- **`chrome.storage.sync`** — a mirror belonging to your *Chrome profile*, not
  to this copy of the extension.

The mirror is what makes the key permanent. Local storage is emptied whenever
Chrome decides the extension is a different extension, which happens if you
remove and re-add the folder, or load it from a new path. When the extension
starts and finds local empty, it refills it from the mirror. You will not be
asked for the key again after a `git pull`, a reload, a reinstall, or on a
second machine signed into the same Chrome.

Not in the extension folder, not in git, not in Google Apps Script, not on any
server of ours. It is sent to `api.anthropic.com` and nowhere else. **Remove**
in Settings deletes both copies.

### The key box always looks empty

The **Anthropic API key** field is a place to paste a *new* key, not a display
of the stored one, so it is blank every time the page opens. The line beneath it
is the truth: `✓ Key stored (sk-ant-api0…XXXX)`.

## Proving the replies are really Claude's

Three ways, in increasing effort:

1. **Settings -> Claude -> Test Claude now.** Makes one real call on a sample
   Dubai/UK citations thread and prints the bullets it got back, with the time
   taken and the exact cost. Costs about a tenth of a cent.
2. **Open any lead on the dashboard.** Above the draft it says either
   `Claude wrote the N technical line(s) in this draft:` followed by them, or
   `Built-in rules wrote this one, not Claude.`
3. **The log** at the bottom of the dashboard: `Claude wrote specifics for 3/3
   lead(s)`, or the reason it stood down.

A lead found *before* the key was saved keeps its built-in lines. Press
**Rebuild drafts** to have Claude redo them.

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

## What you can see, and what is an estimate

Three numbers sit at the top of the dashboard:

| tile | what it is |
|---|---|
| **claude today** | exact - counted from the token usage Anthropic returns on every call |
| **left today** | exact - the daily limit minus the above |
| **balance left (estimate)** | **our own count**, not Anthropic's |

There is no Anthropic endpoint that reports your remaining credit. The usage and
cost reports that do exist need a separate **Admin** API key and report for the
whole organisation, not for one key. So the balance works the only way it can:
you tell Settings what you topped up, and it counts down as calls are made.

It will drift from the real figure if you use the same key elsewhere. Treat it
as a fuel gauge and check console.anthropic.com for the true number.
**Start the count again** in Settings resets our count to zero; it changes
nothing at Anthropic and does not touch your key.

## The spend limit

Settings -> Claude -> **Spend limit per day**. Default **$1.00**.

When the day's spend reaches it, Claude stands down and replies fall back to the
built-in rules in `src/specifics.js`. It resets at local midnight. Set it to 0
for no limit.

The limit applies to **today only**, never to the all-time total, so a long
history can never stop tomorrow's checks.

Each call is priced at the model that actually ran it, so switching models later
cannot retroactively change what has already been spent.

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
