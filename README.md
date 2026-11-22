# Fast csv-reader 1.0.0 drop-in

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jeeje10/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jeeje10/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121) on make.fun.

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what csv-reader 1.0.0 returns for `{text, header}` — `{columns, rows, errors}`
— but much faster: instead of walking the text one character at a time, it
jumps between delimiters with `indexOf` and a shared delimiter regex, cuts
fields out with `slice`, and takes whole quote-free records in one `split`.
The rare broken-row cases (stray CRs, doubled quotes, unterminated quotes,
junk after a closing quote, embedded newlines) fall back to short loops that
follow the reference's policy exactly.

Verified against the reference on the kit's 6-case practice set, 57 edge
cases, and 20,000 randomized differential fuzz cases — all identical.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`,
answers each with `run`, and writes `/output/answers.json`.
