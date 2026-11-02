// Times are shown in the configured zone on a 12 hour clock, and grouped in
// that zone too - a thread posted just after IST midnight belongs to the IST
// day wherever the laptop is.
import { stamp, clock, hourLabel, dayLabel, longDay, partsIn, todayKey, zoneOf, DEFAULT_TZ } from '../src/timefmt.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const IST = { timezone: 'Asia/Kolkata' };
const NY = { timezone: 'America/New_York' };

ok('India is the default', zoneOf({}) === DEFAULT_TZ && DEFAULT_TZ === 'Asia/Kolkata');
ok('an empty zone means this computer', zoneOf({ timezone: '' }) === undefined);

// 13:15 UTC is 18:45 IST.
const iso = '2026-09-15T13:15:00Z';
ok('a stamp is 12 hour, in zone', stamp(iso, IST) === '15 Sept 6:45 pm', stamp(iso, IST));
ok('the clock is 12 hour', clock(iso, IST) === '6:45 pm', clock(iso, IST));
ok('the same moment reads differently in New York', stamp(iso, NY) === '15 Sept 9:15 am', stamp(iso, NY));

// No 24 hour numbers anywhere on the hour axis.
const hours = Array.from({ length: 24 }, (_, h) => hourLabel(h, IST));
ok('midnight is 12 am, not 00', hours[0] === '12 am', hours[0]);
ok('noon is 12 pm, not 12:00', hours[12] === '12 pm', hours[12]);
ok('8pm is 8 pm, not 20', hours[20] === '8 pm', hours[20]);
ok('11pm is 11 pm, not 23', hours[23] === '11 pm', hours[23]);
ok('no hour label is a 24 hour number', !hours.some((h) => /^(1[3-9]|2[0-3]|0\d)\b/.test(h)), hours.join(','));
ok('every hour is am or pm', hours.every((h) => /\s(am|pm)$/.test(h)), hours.join(','));

// Grouping: 19:30 UTC is 1am the NEXT day in IST.
const late = new Date('2026-09-15T19:30:00Z');
ok('after IST midnight counts as the next IST day', partsIn(late, IST).key === '2026-09-16', partsIn(late, IST).key);
ok('and the hour is the IST hour', partsIn(late, IST).hour === 1, String(partsIn(late, IST).hour));
ok('the same moment is still the 15th in New York', partsIn(late, NY).key === '2026-09-15', partsIn(late, NY).key);
ok('weekday follows the zone too', partsIn(late, IST).weekday === 3 && partsIn(late, NY).weekday === 2,
   `${partsIn(late, IST).weekday} vs ${partsIn(late, NY).weekday}`);

ok('a day label is short', dayLabel(new Date(iso), IST) === '15 Sept', dayLabel(new Date(iso), IST));
ok('a long day names the weekday', longDay(new Date(iso), IST) === 'Tuesday 15 September', longDay(new Date(iso), IST));
ok('an unreadable date does not crash', stamp('nonsense', IST) === '—');
ok('today is a date key', /^\d{4}-\d{2}-\d{2}$/.test(todayKey(IST)));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
