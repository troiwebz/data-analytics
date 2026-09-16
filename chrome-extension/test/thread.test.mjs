// Reading the thread page: the post body, and what the competition already said.
//
// This is the fix for "Crypto Runner" coming back as wallet and exchange
// operations across several chains. The buyer wanted someone to run crypto ads
// and keep the accounts off suspension - which the post says plainly, and the
// title does not say at all. Claude only ever saw the title.
import { parseThread } from '../src/thread.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

// The real thread, in XenForo's markup: the buyer, then two freelancers
// pitching, each with the signature advertising they all carry.
const HTML = `
<article class="message message--post js-post" data-author="badbang4u">
  <div class="message-content">
    <div class="bbWrapper">Crypto Runner<br />
Hi, I want a crypto runner. You&#039;ll have to run my ads, and to make sure they don&#039;t get suspended !<br />
This will be a continuous job</div>
  </div>
</article>
<article class="message message--post js-post" data-author="AnyAdz">
  <div class="message-content">
    <div class="bbWrapper">We can run crypto ads campaign for your business, We if you don&#039;t have certificate,
then we can use our own certificate or we use cloaking.</div>
    <div class="message-signature"><a href="https://anyadz.com/bhw">Monthly Ad Management</a>
    Telegram: @AnyAdzCom<br>WhatsApp: @AnyAdzCom</div>
  </div>
</article>
<article class="message message--post js-post" data-author="AGENCY LINK">
  <div class="message-content">
    <div class="bbWrapper"><blockquote class="bbCodeBlock">badbang4u said: Hi, I want a crypto runner.</blockquote>
Hello<br /><br />We have experience running Crypto wallet, investment and exchange ads on Google and Meta<br /><br />
The campaigns will run without problems and will be scalable</div>
  </div>
</article>`;

const t = parseThread(HTML);

// The body: the thing that was missing.
ok('the post body is read', /crypto runner/i.test(t.body), JSON.stringify(t.body.slice(0, 60)));
ok('including what the job actually is', /run my ads/i.test(t.body), JSON.stringify(t.body));
ok('and the constraint that decides the whole job', /suspended/i.test(t.body), JSON.stringify(t.body));
ok('entities are decoded, not left as &#039;', !t.body.includes('&#') && t.body.includes("You'll"), JSON.stringify(t.body.slice(0, 40)));

// The replies: the competition.
ok('both replies are read', t.replies.length === 2, String(t.replies.length));
ok('the buyer is not counted as a reply', !t.replies.some((r) => r.author === 'badbang4u'), JSON.stringify(t.replies.map((r) => r.author)));
ok('each reply says who wrote it', t.replies[0].author === 'AnyAdz' && t.replies[1].author === 'AGENCY LINK',
   JSON.stringify(t.replies.map((r) => r.author)));
ok('the first pitch is kept', /cloaking/i.test(t.replies[0].text), JSON.stringify(t.replies[0].text));
ok('the second pitch is kept', /without problems and will be scalable/i.test(t.replies[1].text), JSON.stringify(t.replies[1].text));

// Noise that would crowd out the actual claim.
ok('signature advertising is dropped', !/anyadz\.com|Monthly Ad Management/i.test(t.replies[0].text), JSON.stringify(t.replies[0].text));
ok('contact lines are dropped', !/Telegram|WhatsApp/i.test(t.replies[0].text), JSON.stringify(t.replies[0].text));
ok('a quote of the buyer is not counted as their own words',
   !/badbang4u said/i.test(t.replies[1].text), JSON.stringify(t.replies[1].text));
ok('but the reply that followed the quote survives', /^Hello/.test(t.replies[1].text), JSON.stringify(t.replies[1].text.slice(0, 30)));

// A thread we cannot read must degrade, never throw.
ok('an empty page gives nothing rather than throwing', parseThread('').body === '' && parseThread('').replies.length === 0);
ok('junk gives nothing too', parseThread('<html><body>login required</body></html>').body === '');

// A thread with no replies yet: the common case, and the best case.
const alone = parseThread(HTML.split('<article').slice(0, 2).join('<article'));
ok('a thread with no replies still gives the body', /run my ads/i.test(alone.body), JSON.stringify(alone.body.slice(0, 40)));
ok('and an empty competitor list', alone.replies.length === 0, String(alone.replies.length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
