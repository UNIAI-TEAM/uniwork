"""The agent's only way into UniWork: /api/v1/meetings/{id}/agent/* with the
per-meeting uwma_ token from the job metadata (spec §7.1, ADR 0045)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

log = logging.getLogger("scribe.api")


class ApiError(Exception):
    def __init__(self, status: int, path: str) -> None:
        super().__init__(f"{path}: HTTP {status}")
        self.status = status


class UniworkClient:
    """Retries 5xx and network errors with exponential backoff; a 4xx is final."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        meeting_id: str,
        token: str,
        *,
        retries: int = 4,
        backoff_s: float = 0.5,
    ) -> None:
        self._s = session
        self._base = f"{base_url}/api/v1/meetings/{meeting_id}/agent"
        self._headers = {"Authorization": f"Bearer {token}"}
        self._retries = retries
        self._backoff = backoff_s

    async def _call(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        retries: int | None = None,
        request_timeout: aiohttp.ClientTimeout | None = None,
    ) -> dict:
        retries = self._retries if retries is None else retries
        # aiohttp reads timeout=None as "no timeout at all", not the session's.
        timeout = self._s.timeout if request_timeout is None else request_timeout
        delay = self._backoff
        for attempt in range(retries + 1):
            try:
                async with self._s.request(
                    method, self._base + path, json=body, headers=self._headers, timeout=timeout
                ) as r:
                    if r.status < 400:
                        return await r.json()
                    if r.status < 500:
                        raise ApiError(r.status, path)
                    err: Exception = ApiError(r.status, path)
            except (aiohttp.ClientError, TimeoutError) as e:
                err = e
            if attempt == retries:
                raise err
            log.warning("api retry path=%s attempt=%d err=%s", path, attempt + 1, type(err).__name__)
            await asyncio.sleep(delay)
            delay *= 2
        raise AssertionError("unreachable")

    async def started(self, participant_sid: str) -> None:
        await self._call("POST", "/started", {"participant_sid": participant_sid})

    async def context(self) -> dict:
        return await self._call("GET", "/context")

    async def segments(self, segments: list[dict]) -> dict:
        return await self._call("POST", "/segments", {"segments": segments})

    async def extract(self) -> dict:
        """Live action items (spec §4.4). Never retried: each try is a model
        call the organization pays for, and the next due call covers the same
        lines. The server waits on the model, hence the longer timeout."""
        return await self._call("POST", "/extract", retries=0, request_timeout=aiohttp.ClientTimeout(total=60))

    async def translate(self, segments: list[dict], target: str) -> dict:
        """Translated captions (spec §5.3). Never retried: each try is a model
        call, and a late translation is worthless; the original stays."""
        return await self._call(
            "POST",
            "/translate",
            {"segments": segments, "target": target},
            retries=0,
            request_timeout=aiohttp.ClientTimeout(total=10),
        )

    async def finished(self, stt_session_ms: int) -> None:
        await self._call("POST", "/finished", {"stt_session_ms": stt_session_ms})
