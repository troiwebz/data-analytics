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

## The question goes in public, the offer goes in the PM

The public reply is now:

    Hey @buyer,
    <strongest technical line>  Core work for us.
    <one question>
    PM sent with the specifics.

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
