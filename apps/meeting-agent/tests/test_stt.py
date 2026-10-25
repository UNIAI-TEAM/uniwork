"""make_stt options (benchmark #18, #15): the room mic is far-field with a
speaker cap, a headset near-field; the live STT host follows the region of
batch transcription unless SCRIBE_STT_BASE_URL names one."""

import pytest

from scribe.config import stt_base_url
from scribe.stt import SHARED_MIC_MAX_SPEAKERS, make_stt


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test-key")


def test_room_mic_is_far_field_with_max_speakers():
    s = make_stt("assemblyai", ["Lan"], diarize=True, base_url="wss://streaming.eu.assemblyai.com")
    assert s._opts.voice_focus == "far-field"
    assert s._opts.speaker_labels is True
    assert s._opts.max_speakers == SHARED_MIC_MAX_SPEAKERS
    assert s._base_url == "wss://streaming.eu.assemblyai.com"


def test_headset_is_near_field_without_diarization():
    s = make_stt("assemblyai", [], diarize=False, base_url="wss://streaming.assemblyai.com")
    assert s._opts.voice_focus == "near-field"
    assert not s._opts.speaker_labels
    assert not s._opts.max_speakers


@pytest.mark.parametrize(
    ("env", "want"),
    [
        ({}, "wss://streaming.assemblyai.com"),
        ({"AI_MEETING_TRANSCRIBE_BASE_URL": "https://api.eu.assemblyai.com"}, "wss://streaming.eu.assemblyai.com"),
        ({"AI_MEETING_TRANSCRIBE_BASE_URL": "https://api.assemblyai.com"}, "wss://streaming.assemblyai.com"),
        (
            {
                "SCRIBE_STT_BASE_URL": "wss://custom.example/",
                "AI_MEETING_TRANSCRIBE_BASE_URL": "https://api.eu.assemblyai.com",
            },
            "wss://custom.example",
        ),
    ],
)
def test_stt_base_url_defaults_to_the_batch_region(env, want):
    assert stt_base_url(env) == want
