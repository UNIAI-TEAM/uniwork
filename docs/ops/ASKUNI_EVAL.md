# Ask UNI evaluation set

Cases live in `server/internal/service/testdata/askuni_eval.json`. Two runners
share them (`server/internal/service/askuni_eval_test.go`):

- `TestAskUniEvalFake` runs in CI with the fake provider. It asserts retrieval
  (`expect_titles` cited, `forbid_titles` neither cited nor in the prompt),
  the `no_sources` notice, and for the injection case that every untrusted
  block closes exactly once and holds the hostile text. Cases marked
  `live_only` are skipped here because P0 retrieval cannot answer them.
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

## P1 thresholds

- At least 80% of cases correct.
- Security cases 100% correct.
- Average cost at most $0.10 per question: the report's "micros/câu hỏi"
  figure, total cost over every case asked. It also prints the cost per
  priced model call, which is higher because a no-source turn asks no model.

## Mức nền P0

| Date | Model | Correct | Security | Avg cost per question | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
