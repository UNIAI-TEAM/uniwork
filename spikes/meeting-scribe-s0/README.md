# S0 spike: meeting scribe agent (UNI-2022)

Throwaway reference code for spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md`
§12 row S0. Not wired into the product; results are in
`docs/superpowers/specs/2026-10-20-meeting-scribe-agent-s0-results.md`.

| File | What it shows |
|---|---|
| `agent.py` | `uniwork-scribe` worker: explicit dispatch only, `on_request` rejects bad metadata, identity `uw_agent_scribe`, `add_participant_entrypoint`, `AUDIO_ONLY`, Silero VAD → one STT stream per mic track, captions on `uw.caption`, STT session closed after `SCRIBE_IDLE_CLOSE_S` (30) s of VAD silence and reopened on speech. Fake STT by default; `make_stt()` holds the AssemblyAI options S1 would use. |
| `dispatch/main.go` | Server side: `server-sdk-go/v2` v2.12.2 `CreateDispatch` + `ListDispatch` for `uw_mtg_<id>` with D6-shaped metadata. |
| `e2e.py` | Joins rooms A (dispatch), B (no dispatch), C (invalid metadata), publishes macOS `say` speech, reads captions, asserts and prints latency. |
| `boundary_check.py` | Closing an STT session with a turn still open delivers that turn as a final. |

## Run (macOS, local LiveKit)

```bash
# from the worktree root
bash scripts/ensure-livekit.sh .env.worktree          # livekit-server v1.9.12 on ws://localhost:7880
cd spikes/meeting-scribe-s0
uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt
export LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret_must_be_at_least_32_chars

.venv/bin/python agent.py start            # terminal 1; health on :8091 (SCRIBE_HEALTH_PORT)
.venv/bin/python e2e.py                    # terminal 2; ~70 s, prints PASS/FAIL lines and latency
.venv/bin/python boundary_check.py         # no LiveKit needed

# dispatch by hand
(cd dispatch && go run . -meeting 01ABC)   # room uw_mtg_01ABC
```

`e2e.py` needs `go` (it runs `dispatch/` with `go run`) and the macOS `say` command.
`SCRIBE_IDLE_CLOSE_S` must match between the agent and `e2e.py`.
