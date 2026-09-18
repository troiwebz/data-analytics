// Never send this extension's own interface to a buyer.
//
// This happened. The editor card carried a line saying what was being edited
// and how to copy it, with the draft underneath in one message. Tapping the
// code block copies only the draft - but long-pressing and choosing Copy takes
// the whole message. Pasted back, the instructions became the draft, and a real
// buyer received:
//
//   ✏️ Editing the DM — FASHION BRAND CAMPAIGN / GMC SUSPENDED / ...
//   Tap the text to copy it, paste it back, change what you like and send.
//   Hi EZE111, ...
//
// The earlier design put the draft in a message of its own precisely so a copy
// could not pick up anything else. Merging them for in-place editing removed
// that protection without replacing it. So: the wrapper is stripped on the way
// in, and a hard stop refuses to send anything still carrying it - a stop that
// is not part of the tunable compliance rules, because it must not be tunable.
import { botTextIn, stripBotText, BOT_MARKERS } from '../src/compliance.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

// The message that actually went out, as closely as it can be reproduced.
const REAL = `✏️ Editing the DM — FASHION BRAND CAMPAIGN / GMC SUSPENDED / LOOKING FOR SOLUTIO
Tap the text to copy it, paste it back, change what you like and send.
Hi EZE111,

Just read your HAF thread: https://www.blackhatworld.com/seo/fashion-brand-campaign-gmc-suspended-looking-for-solution.1848614/

Why We Can Do It:

1. GMC Suspensions are very hard to retrieve. So we need more details on how to sort it.
2. Clear price before any work starts

You can first check our plan and confirm the project, so you see it before anything is paid.

Drop a reply and we can get started immediately.

Thanks!!`;

ok('the message that reached a buyer is recognised', !!botTextIn(REAL), botTextIn(REAL));
ok('and it names what it found', /Editing the DM/.test(botTextIn(REAL)), botTextIn(REAL));

const fixed = stripBotText(REAL);
ok('the wrapper is removed', !botTextIn(fixed.text), botTextIn(fixed.text));
ok('and exactly the two instruction lines went', fixed.removed.length === 2, JSON.stringify(fixed.removed));
ok('the pitch itself is untouched', fixed.text.startsWith('Hi EZE111,'), fixed.text.slice(0, 40));
ok('including the thread link', /1848614/.test(fixed.text));
ok('and the sign-off', /Thanks!!$/.test(fixed.text), fixed.text.slice(-30));
ok('no blank gap is left at the top', !/^\s/.test(fixed.text), JSON.stringify(fixed.text.slice(0, 10)));

// Every other thing the bot writes for you to read.
for (const [label, sample] of [
  ['the copy hint', 'blah\n(tap to copy)\nmore'],
  ['the cancel line', 'Send /cancel to leave it as it is'],
  ['the cancel button', 'Leave it as it is'],
  ['the PM card header', '✉️ PM to buyer123'],
  ['the inbox link', 'Your BHW inbox'],
  ['the night countdown', '🌙 Night mode: posting in 18 min unless you tap Hold.'],
  ['the duplicate card', 'Might already be a duplicate'],
  ['the truncation notice', '[cut - full text is on the dashboard]']
]) {
  ok(`${label} is caught too`, !!botTextIn(sample), sample);
}

// And nothing a buyer would ever receive is touched.
for (const [label, sample] of [
  ['an ordinary pitch', 'Hi there,\n\nWe run Google Ads for fashion brands. Happy to take a look.\n\nThanks!'],
  ['one mentioning editing', 'We can handle editing the product feed and the campaign structure for you.'],
  ['one mentioning a DM', 'Send me a DM with the account id and I will check it.'],
  ['one mentioning night work', 'We monitor the campaigns at night as well as during the day.'],
  ['one mentioning a duplicate', 'Your feed has duplicate SKUs, which is likely why it was suspended.'],
  ['one about copying', 'I will copy the winning ad set and scale it.'],
  ['an empty draft', '']
]) {
  ok(`${label} is left alone`, !botTextIn(sample), `${sample.slice(0, 50)} -> ${botTextIn(sample)}`);
  ok(`  and survives stripping intact`, stripBotText(sample).text === sample.trim(), label);
}

// A paste of nothing but the instructions leaves no message at all, which has
// to be refused rather than sent as an empty PM.
const onlyWrapper = stripBotText('✏️ Editing the DM — a thread\nTap the text to copy it, paste it back, change what you like and send.');
ok('instructions alone leave nothing to send', onlyWrapper.text === '', JSON.stringify(onlyWrapper.text));

ok('the marker list is not empty, which would disable the whole guard', BOT_MARKERS.length > 5, String(BOT_MARKERS.length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
