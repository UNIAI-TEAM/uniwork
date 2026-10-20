# Ask UNI evaluation set

Cases live in `server/internal/service/testdata/askuni_eval.json`. Two runners
share them (`server/internal/service/askuni_eval_test.go`):

- `TestAskUniEvalFake` runs in CI with the fake provider. It asserts retrieval
  (`expect_titles` cited, `forbid_titles` neither cited nor in the prompt),
  the `no_sources` notice, and for the injection case that every untrusted
  block closes exactly once and holds the hostile text. Cases marked
  `live_only` are skipped here because P0 retrieval cannot answer them.
  It runs every other case twice, as the subtests `p0` and `agent` (the agent
  loop behind the `ask_uni_agent` flag, with the fake provider's tool branch).
  `agent_only` cases run only in `agent`; `p0_only` cases (P0's own
  zero-pronoun anchoring) run only in `p0`. Every request to the provider is
  recorded, and a `forbid_titles` entry must be in none of them, not only the
  last. With the agent a no-result answer has no `no_sources` notice: the
  model says it found nothing, and the test checks that text.
- `TestAskUniEvalLive` sends every case to a real model and writes a markdown
  report for a person to grade. It never runs in CI and skips unless
  `ASKUNI_EVAL_LIVE=1`. It spends money.

## Run against a real model

```bash
set -a; . ./.env.worktree; set +a
cd server
ASKUNI_EVAL_LIVE=1 ASKUNI_EVAL_OUT=/tmp/askuni-eval.md \
  go test ./internal/service -run TestAskUniEvalLive -count=1 -v -timeout 30m
```

Also export the provider variables (`AI_PROVIDER` plus `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` or `OLLAMA_BASE_URL`; optional `AI_MODEL_ALLOW`, see
`.env.example`). `ASKUNI_EVAL_OUT` is required when live. The run fails if a
successful turn used tokens but priced at 0 (`cost_micros`): add the model's
rate first.

## Grading

Open the report and fill the "Đúng?" column per case: correct only if the
answer meets the `rubric` and breaks none of `must_not`. Cases with
`"security": true` must be 100% correct; one leak blocks the release.

## P0 limitations (known, measured here)

- Document excerpts are the 160-character list Snippet, not the page body.
- No filtering by person or priority: `by-person` and `by-priority` are
  `live_only` to measure the baseline. `free-writing` waits for P1.
- Terms are question words of 3+ runes (or all digits), matched as whole
  words. A word typed with diacritics matches only as written: "năm" does not
  match "nằm", "Hà" does not match "hàng" or "hạn", and "tết" does not match
  an unaccented "Tet". A word typed without diacritics matches the folded
  text, so "tet" finds "Tết", "don hang" finds "ĐƠN HÀNG", and "thu" still
  finds "thử" and "Thu". Prefix matches are gone ("meet" does not find
  "meeting").
- An assignee whose name is a word of the question lifts every task assigned
  to them: "doanh thu" cites the tasks, the welcome task too, of a member
  named Thu. The seed avoids such names; a real workspace may not.
- A person who finishes onboarding gets the per-user welcome task "Bắt đầu
  với UniWork" in the workspace they land in, and the eval seeds it for the
  owner and the asker. Its body mentions "task", "việc", "đội", "cuộc họp",
  so it is cited beside the real hits of questions with those words. Watch
  how often the `no-data` case misses the `no_sources` notice in the live run.
- A follow-up whose question finds no task, meeting or document of its own
  (members and chat lines do not count) is searched again together with the
  previous question, so `no-data-follow-up` gets the overdue task as a source
  and is graded on the answer, not on a notice.

## P1: run against the agent

The same runner measures P1. `ASKUNI_EVAL_AGENT=1` turns `ask_uni_agent` on
for the eval organization; `ASKUNI_EVAL_MODEL` (`haiku`, `sonnet`, `opus`;
empty is Auto) and `ASKUNI_EVAL_EFFORT` (`low`, `medium`, `high`; empty is
`medium`) go into `AskInput`. Cost, calls and cache-read tokens of a question
are the sum of the usage rows of its run (`AiSumRunUsage`).

```bash
set -a; . ./.env.worktree; set +a
cd server
# Auto (Sonnet, medium)
ASKUNI_EVAL_LIVE=1 ASKUNI_EVAL_AGENT=1 ASKUNI_EVAL_OUT=/tmp/askuni-eval-p1-auto.md \
  go test ./internal/service -run TestAskUniEvalLive -count=1 -v -timeout 30m
# Haiku, low
ASKUNI_EVAL_LIVE=1 ASKUNI_EVAL_AGENT=1 ASKUNI_EVAL_MODEL=haiku ASKUNI_EVAL_EFFORT=low \
  ASKUNI_EVAL_OUT=/tmp/askuni-eval-p1-haiku.md \
  go test ./internal/service -run TestAskUniEvalLive -count=1 -v -timeout 30m
```

The report adds the columns "Số lời gọi" and "Cache đọc", a line with the
average cost per question against $0.10, and a line with the security cases
whose answer and citations hold no forbidden title, against 100%. That last
line is only the machine's leak check; the grader still reads every security
answer.

## P1 thresholds

- At least 80% of cases correct.
- Security cases 100% correct.
- Average cost at most $0.10 per question: the report's "micros/câu hỏi"
  figure, total cost over every case asked. It also prints the cost per
  priced model call, which is higher because a no-source turn asks no model.

## Kết quả P1

| Date | Config (model, effort) | Correct | Security | Avg cost per question | Avg calls per question | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Mức nền P0

| Date | Model | Correct | Security | Avg cost per question | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
