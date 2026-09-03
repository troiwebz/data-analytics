# Guest Outreach Sender — setup

About 15 minutes. Do it once per sending account.

---

## Using a free @gmail.com account?

**Skip Step 1 entirely.** Google already publishes SPF, DKIM and DMARC for
`gmail.com`, so there is no DNS to configure. Jump to Step 2.

What to do instead, because on a free address your identity is all you have:

- Set a real profile photo and full name on the account. Editors check.
- Put a real site in your signature so there is something behind the name.
- Keep `DAILY_MAX` at 20. Apps Script allows ~100 recipients/day on consumer
  Gmail, but that ceiling is not the constraint — reputation is. Free accounts
  get suspended for bulk sending far faster than Workspace ones.
- Spread volume across accounts rather than raising the cap on one.

The `CONFIG` block in `Code.gs` already ships with these numbers.

---

## 1. Turn on email authentication — *Google Workspace domains only*

In the Google Admin console for the sending domain:

- **Apps → Google Workspace → Gmail → Authenticate email** → generate the DKIM key,
  add the TXT record it gives you to your domain's DNS, then click **Start authentication**.
- Add an **SPF** record to DNS: `v=spf1 include:_spf.google.com ~all`
- Add a **DMARC** record at `_dmarc.yourdomain.com`: `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`

DKIM is off by default. Skipping it is the single most common reason outreach lands in spam.

Check your work at [mxtoolbox.com](https://mxtoolbox.com/SuperTool.aspx) — search your domain
for SPF, DKIM, and DMARC. All three must come back green before you send anything.

---

## 2. Make the sheet

1. New Google Sheet, name it something like `Outreach — yourdomain.com`.
2. **Extensions → Apps Script**.
3. Delete the placeholder code, paste in everything from `Code.gs`, save.
4. Edit the `CONFIG` block at the top — your name, your signature, your subject and body.
5. Run **`setup`** from the function dropdown. Approve the permissions prompt
   (it will warn the app is unverified — that's normal, it's your own script).

You now have three tabs: `Prospects`, `Log`, and a sample row to look at.

---

## 3. Test before you send anything real

`DRY_RUN` is `true` by default — nothing gets sent, drafts get created instead.

1. Run **`sendTestToSelf`** → check your own inbox. This is exactly what a prospect sees.
   Read it on your phone. If it looks like a newsletter, rewrite it.
2. Run **`sendBatch`** → check your Gmail Drafts folder and the `status` column.
3. Run **`showStatus`** → **View → Logs** shows today's allowance and count.

Only when all three look right, set `DRY_RUN: false`.

---

## 4. Go live

Run **`installTriggers`** once. From then on it sends by itself:

- `sendBatch` every 15 minutes — up to 3 emails, weekdays 9am–5pm only
- `checkReplies` every 2 hours — marks anyone who replied so you stop chasing them

Warmup is automatic: 10 emails on day one, +5 each day, capped at 40. Leave the cap alone.

---

## Filling in the sheet

| Column | What goes in it |
|---|---|
| `email` | Verify these before importing. Bounces hurt more than spam complaints. |
| `first_name` | Real first name. If you don't have it, skip the prospect. |
| `site` | Their site, e.g. `exampleblog.com` |
| `personal_line` | **The one that matters.** One specific sentence about something they actually published. |
| `idea_1`, `idea_2` | Two concrete article titles that fit their site. |

Leave `status`, `sent_at`, `thread_id`, `replied`, and `note` empty — the script fills them.

A `personal_line` like *"Loved your blog!"* performs worse than sending nothing.
It has to be something only a reader could have written.

To stop emailing someone permanently, add a tab named `Suppression` and put their
address in column A.

---

## Day-to-day

- Check the `Log` tab for errors.
- Answer replies yourself, from Gmail, like a human.
- Keep bounces under 2%. If they climb, stop and clean the list.
- If replies drop below 3%, the problem is your targeting or your copy — never the script.

---

## Doing this across several accounts

Repeat the whole thing per account: separate sheet, separate script, separate
login. Keeping them independent is the point — if one account's reputation goes
bad, it doesn't take the others down with it.

| Setup | Per day | Per month |
|---|---|---|
| 3 free Gmail accounts @ 20/day | 60 | ~1,200 |
| 5 free Gmail accounts @ 20/day | 100 | ~2,000 |
| 5 Workspace mailboxes @ 40/day | 200 | ~4,000 |

Never raise a single account's cap to hit a number. Add accounts instead.
