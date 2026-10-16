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
- Terms are folded and 3 runes long, so unrelated words can match ("thu" in
  "thử", "nam" in "năm"). A starter document such as "Bắt đầu với UniWork"
  can then be cited for "doanh thu năm 2019". Watch how often the `no-data`
  case misses the `no_sources` notice in the live run.

## P1 thresholds

- At least 80% of cases correct.
- Security cases 100% correct.
- Average cost at most $0.10 per question.

## Baseline P0

| Date | Model | Correct | Security | Avg cost | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
