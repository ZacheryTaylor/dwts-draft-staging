// Builds tests/fixtures/season35-sim-weeks4-5.wikitext: the real season 35 article (rev 1377959004)
// plus SIMULATED weeks 4 and 5, to exercise week creation, naming, absent-judge scaling,
// two-dance averaging, guest-judge removal, withdrawals and bonus rows. Expected results are
// written next to it (hand-derived formulas, independent of the parser).
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('tests/fixtures/season35-rev1377959004.wikitext', 'utf8');

// Week 4 — Carrie Ann absent: two judges (Derek, Bruno). Expected = (d+b) * 30/20.
const w4 = {
  'Amber & Pasha': [8, 9], 'Ciara & Brandon': [7, 7], 'Connor & Rylee': [7, 8], 'Ezra & Daniella': [8, 8],
  'Guillermo & Witney': [5, 6], 'Harry & Jenna': [9, 8], 'Jackson & Emma': [6, 7], 'Jenna & Val': [8, 8],
  'Julia & Ezra': [7, 6], 'Maura & Mark': [8, 9], 'Tatyana & Jan': [7, 7], 'Tyler & Sharna': [6, 6]
};
const w4Out = 'Guillermo & Witney';
let out = src;
for (const [couple, j] of Object.entries(w4)) {
  const re = new RegExp(`(! scope="row" \\| ${couple.replace('&', '&')}\\n)\\|\\n(\\|[^\\n]*\\n\\|[^\\n]*\\n)\\|\\n`);
  out = out.replace(re, `$1| ${j[0] + j[1]} (${j.join(', ')})\n$2| ${couple === w4Out ? 'bgcolor= f4c7b8 | Eliminated' : 'Safe'}\n`);
}
out = out.replace("=== Week 4: Mariah Carey Night ===\n", "=== Week 4: Mariah Carey Night ===\n''Individual judges' scores in the chart below (given in parentheses) are listed in this order from left to right: [[Derek Hough]], [[Bruno Tonioli]].''\n");

// Week 5 — guest judge (3rd position) + two dances each. Expected = mean of (CA+DH+BT) per dance.
const w5 = {
  'Amber & Pasha': [[9, 9, 10, 9], [10, 10, 10, 10]], 'Ciara & Brandon': [[8, 8, 9, 8], [8, 9, 9, 8]],
  'Connor & Rylee': [[7, 7, 8, 7], [7, 8, 8, 8]], 'Ezra & Daniella': [[9, 8, 9, 9], [9, 9, 10, 9]],
  'Harry & Jenna': [[10, 9, 10, 9], [10, 10, 10, 10]], 'Jackson & Emma': [[7, 7, 8, 7], [8, 7, 8, 8]],
  'Jenna & Val': [[9, 9, 9, 9], [9, 10, 10, 9]], 'Julia & Ezra': [[8, 8, 8, 7], [8, 8, 9, 8]],
  'Maura & Mark': [[9, 9, 10, 10], [10, 9, 10, 10]], 'Tatyana & Jan': [[8, 8, 9, 8], [8, 8, 8, 9]],
  'Tyler & Sharna': [[7, 6, 7, 7], [7, 7, 7, 7]]
};
const result5 = { 'Connor & Rylee': 'bgcolor= f4c7b8 | Eliminated', 'Tyler & Sharna': 'bgcolor= f4c7b8 | Withdrew' };
const rows = Object.entries(w5).map(([c, ds]) => `|-\n! rowspan="2" scope="row" | ${c}\n| ${ds[0].reduce((a, b) => a + b)} (${ds[0].join(', ')})\n| Jive\n| "Song A"\n| rowspan="2" ${result5[c] ? '| ' + result5[c].replace('bgcolor= f4c7b8 | ', '') : '| Safe'}\n|-\n| ${ds[1].reduce((a, b) => a + b)} (${ds[1].join(', ')})\n| Tango\n| "Song B"`).join('\n');
const bonus = Object.keys(w5).map((c, i) => `|-\n! scope="row" | ${c}\n| ${i % 4}`).join('\n');
const week5 = `=== Week 5: Super Bowl Night ===
''Individual judges' scores in the chart below (given in parentheses) are listed in this order from left to right: Carrie Ann Inaba, Derek Hough, [[Kym Johnson]], Bruno Tonioli.''

Couples are listed in the order they performed.
{| class="wikitable sortable" style="text-align:center; width:90%"
|+''Dancing with the Stars'' (season 35) – Week 5
|-
! scope="col" | Couple
! scope="col" | Scores
! scope="col" class="unsortable"| Dance
! scope="col" class="unsortable"| Music
! scope="col" class="unsortable"| Result
${rows}
|}
;Dance marathon
{| class="wikitable" style="text-align:center"
|+''Dancing with the Stars'' (season 35) – Week 5 Dance marathon
|-
! scope="col" | Couple
! scope="col" | Bonus
${bonus}
|}

`;
out = out.replace('<!--\n=== Week 5: Super Bowl Night ===', week5 + '<!--\n=== Week 5 (placeholder) ===');
writeFileSync('tests/fixtures/season35-sim-weeks4-5.wikitext', out);

const ids = { 'Amber & Pasha': 'pashkov', 'Ciara & Brandon': 'armstrong', 'Connor & Rylee': 'arnold', 'Ezra & Daniella': 'karagach', 'Guillermo & Witney': 'carson', 'Harry & Jenna': 'johnson', 'Jackson & Emma': 'slater', 'Jenna & Val': 'chmerkovskiy', 'Julia & Ezra': 'sosa', 'Maura & Mark': 'ballas', 'Tatyana & Jan': 'ravnik', 'Tyler & Sharna': 'burgess' };
const expected = {
  4: Object.fromEntries(Object.entries(w4).map(([c, j]) => [ids[c], { score: (j[0] + j[1]) * 30 / 20, eliminated: c === w4Out }])),
  5: Object.fromEntries(Object.entries(w5).map(([c, ds]) => [ids[c], { score: ds.map((d) => d[0] + d[1] + d[3]).reduce((a, b) => a + b) / 2, eliminated: Boolean(result5[c]) }]))
};
writeFileSync('tests/fixtures/season35-sim-expected.json', JSON.stringify(expected, null, 2));
console.log('fixture written; week 4 rows filled:', (out.match(/\| \d+ \(\d+, \d+\)\n/g) || []).length);
