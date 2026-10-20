import json

from scribe.job import parse_metadata, reports_finished, shared_mic, should_transcribe
from scribe.keyterms import build_keyterms, refresh_keyterms
from scribe.stt import make_stt

META = json.dumps({"meeting_id": "01M", "token": "uwma_abc.def", "locale": "vi"})


def test_accepts_only_its_own_room_with_a_meeting_token():
    assert parse_metadata(META, "uw_mtg_01M") == {"meeting_id": "01M", "token": "uwma_abc.def", "locale": "vi"}
    for meta, room in [
        (META, "uw_mtg_OTHER"),
        (META, "lms_room_1"),
        ("", "uw_mtg_01M"),
        ("not json", "uw_mtg_01M"),
        ("[]", "uw_mtg_01M"),
        (json.dumps({"meeting_id": "01M"}), "uw_mtg_01M"),
        (json.dumps({"meeting_id": "01M", "token": "eyJhbGci.session.jwt"}), "uw_mtg_01M"),
    ]:
        assert parse_metadata(meta, room) is None, (meta, room)


def test_locale_defaults_to_vi():
    meta = json.dumps({"meeting_id": "01M", "token": "uwma_x"})
    assert parse_metadata(meta, "uw_mtg_01M")["locale"] == "vi"


def test_skips_agents_and_egress():
    assert should_transcribe("uw_participant_p1", False, False)
    assert not should_transcribe("uw_agent_scribe", False, False)
    assert not should_transcribe("uw_participant_p1", True, False)
    assert not should_transcribe("EG_recorder", False, True)


def test_keyterms_dedupe_cap_and_skip_long():
    ctx = {
        "meeting_title": "Giao ban  tuần",
        "workspace_name": "Phòng Kế hoạch",
        "project_name": "",
        "participant_names": ["Nguyễn Văn An", "nguyễn văn an", "x" * 51] + [f"Người {i}" for i in range(200)],
    }
    terms = build_keyterms(ctx)
    assert terms[:3] == ["Giao ban tuần", "Phòng Kế hoạch", "Nguyễn Văn An"]
    assert len(terms) == 100
    assert all(len(t) <= 50 for t in terms)


def test_a_replaced_connection_does_not_finish_the_run():
    """Review item 10."""
    assert reports_finished(None)
    assert reports_finished("ROOM_DELETED")
    assert not reports_finished("DUPLICATE_IDENTITY")


async def test_keyterms_refresh_in_place_and_survive_a_failed_read():
    """Review item 8: a newcomer's name joins the list every new stream reads."""
    terms = build_keyterms({"meeting_title": "Giao ban", "participant_names": ["An"]})

    async def fresh() -> dict:
        return {"meeting_title": "Giao ban", "participant_names": ["An", "Bình"]}

    async def broken() -> dict:
        raise RuntimeError("server down")

    same = terms
    await refresh_keyterms(fresh, terms)
    assert same is terms and terms == ["Giao ban", "An", "Bình"]
    await refresh_keyterms(broken, terms)
    assert terms == ["Giao ban", "An", "Bình"]


def test_shared_mic_is_the_servers_attribute():
    assert shared_mic({"uw.shared_mic": "1"})
    assert not shared_mic({"uw.shared_mic": ""})  # the server deletes it with an empty value
    assert not shared_mic({})


def test_assemblyai_diarizes_only_the_shared_mic(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test")
    assert make_stt("assemblyai", ["Giao ban"], diarize=True)._opts.speaker_labels is True
    assert make_stt("assemblyai", ["Giao ban"])._opts.speaker_labels is not True
    assert make_stt("fake", [], diarize=True).diarize
