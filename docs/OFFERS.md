# The five closes

Every PM used to end with the same sentence. A buyer who saw two of your PMs
saw the same pitch twice, and the close is the part that decides whether they
reply.

There are now five, and Claude picks whichever fits the thread.

| id | what it says | when Claude picks it |
|---|---|---|
| `pilot` | small paid first order | buyer sounds cautious, burned before, or buying at volume for the first time |
| `ready` | the list or assets already exist | the post is urgent, has a deadline, or complains about slow suppliers |
| `formula` | here is the method, take it | the post is vague, technical, or written by someone who knows the subject |
| `terms` | invoice after the first batch | the budget is large, or the post worries about being scammed |
| `scope` | two questions, then a fixed price and date today | the brief is thin and the real job is unclear |

Each is spintax and is also varied by thread, so two threads that get the same
close still do not read the same.

## No free work

There is no free trial, free sample, free test or free audit, and there will
not be one. That was the rule from the start, and on a board like this free
work mostly buys time wasters.

`pilot` is the risk-reversal offer instead: the smallest useful unit, **at the
normal rate**. The buyer commits little without you working for nothing.

The ban is enforced, not merely requested. The prompt tells Claude not to offer
free work; the filter drops any line that does anyway; and the compliance linter
blocks the finished draft on `free trial`, `free sample`, `free test`,
`for free`, `no charge`, `free of charge`, `at no cost`, `won't cost you` and
`free work`. All three layers are covered by tests.

## The two shapes

**Public reply** - one claim, one question, then the PM:

    Hey @buyer,
    We have handled iGaming ad accounts before, and know the platform restrictions in that vertical.
    Are you after fresh accounts, or keeping the ones you already run alive?
    PM sent with how we would approach it.

**Private message** - fixed shape, every time:

    Hi buyer,
    Came across your thread on HAF: <link>
    Why We Can Do It:                         <- bold in the BHW editor
    1. We have handled iGaming ad accounts before, and know the platform restrictions in that vertical
    2. We can work within the compliance limits for casino and betting creatives across networks
    3. We are familiar with the account stability issues common to iGaming campaigns
    <one of the five closes>
    Ready to start whenever you are.
    Thanks!!

Only the numbered lines and the close change between threads.

The three lines sit under "Why We Can Do It", so each is a claim about **us** -
what we have done, can do, or know about this job. Every one starts with "We".
A line that comes back as a bare noun phrase ("Manual submissions to UAE
directories") is turned into one; a line that instructs the buyer is dropped.

The heading is stored as `**Why We Can Do It:**`. The markers become real bold
when the extension types the PM into BHW, and are stripped from everything you
copy - the dashboard boxes, the Copy buttons and Telegram.

The question is the reason to post publicly at all. An answer lands on the
thread where everyone reading it sees the buyer talking to you, and answering is
easier than ignoring. It must be answerable in a sentence and must split the job
into two routes that would be built or priced differently. It never asks the
budget.

The offer stays in the PM, where the other freelancers reading the thread cannot
see which one you used.

## Changing them

Settings -> Reply templates. `{{offer}}` in a PM template is the close Claude
chose; `{{question}}` in a public template is the question. Edit the five texts
themselves under `offers` in the same page. Spintax `{a|b|c}` works throughout.

To force one close for every thread, put the same text in all five.


## Tone

The message is a quote to someone who has already decided what they want. It is
not advice, and the moment it reads as advice the job is gone.

So the lines never:

- warn the buyer, or say their plan is risky, difficult or a bad idea
- mention terms of service, policies, bans, suspensions, legality or what a
  platform allows
- ask them to justify or clarify why they want it
- hedge: no "usually", "typically", "tends to", "worth noting", "bear in mind"

Where a job is genuinely hard, the line says what we do about it, never that it
is hard. "We create these in batches that hold, using our own number pool"
does the work that "these usually get flagged" throws away.

The prompt says all of this and a filter enforces it, because a model asked
about something awkward reaches for a caveat by reflex. Lines that lecture are
dropped before they reach a draft, and the real examples that cost a job are in
the test suite.

Offers are filtered out of the lines too - a demo, a trial, a sample. The close
is where an offer belongs, and the five closes are the only ones on the table.
