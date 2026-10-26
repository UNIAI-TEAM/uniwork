import asyncio

import aiohttp
import pytest
from aiohttp import web

from scribe.api import ApiError, UniworkClient


@pytest.fixture
async def server():
    calls: list[tuple[str, str, str]] = []
    state = {"fail": 0, "status": 200}

    async def handle(request: web.Request) -> web.Response:
        calls.append((request.method, request.path, request.headers.get("Authorization", "")))
        if state.get("hang"):
            await asyncio.sleep(1)
        if state["fail"] > 0:
            state["fail"] -= 1
            return web.json_response({}, status=503)
        if state["status"] != 200:
            return web.json_response({}, status=state["status"])
        if request.path.endswith("/segments"):
            body = await request.json()
            return web.json_response({"accepted": len(body["segments"]), "duplicates": 0})
        return web.json_response({"status": "ok", "meeting_title": "Giao ban"})

    app = web.Application()
    app.router.add_route("*", "/api/v1/meetings/{id}/agent/{op}", handle)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}", calls, state
    await runner.cleanup()


async def test_calls_carry_the_meeting_token_and_retry_5xx(server):
    url, calls, state = server
    async with aiohttp.ClientSession() as s:
        c = UniworkClient(s, url, "01M", "uwma_tok", backoff_s=0.01)
        state["fail"] = 2
        out = await c.segments([{"segment_id": "a"}])
        assert out == {"accepted": 1, "duplicates": 0}
        assert len(calls) == 3
        assert all(h == "Bearer uwma_tok" for _, _, h in calls)
        assert calls[0][1] == "/api/v1/meetings/01M/agent/segments"
        assert (await c.context())["meeting_title"] == "Giao ban"


async def test_4xx_is_final(server):
    url, calls, state = server
    state["status"] = 409
    async with aiohttp.ClientSession() as s:
        c = UniworkClient(s, url, "01M", "uwma_tok", backoff_s=0.01)
        with pytest.raises(ApiError) as e:
            await c.started("PA_x")
        assert e.value.status == 409
        assert len(calls) == 1


async def test_extract_is_never_retried(server):
    url, calls, state = server
    state["fail"] = 1
    async with aiohttp.ClientSession() as s:
        c = UniworkClient(s, url, "01M", "uwma_tok", backoff_s=0.01)
        with pytest.raises(ApiError) as e:
            await c.extract()
        assert e.value.status == 503
        assert [(m, p) for m, p, _ in calls] == [("POST", "/api/v1/meetings/01M/agent/extract")]


async def test_a_call_without_its_own_timeout_keeps_the_sessions(server):
    url, _, state = server
    state["hang"] = True
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=0.2)) as s:
        c = UniworkClient(s, url, "01M", "uwma_tok", retries=0)
        with pytest.raises(TimeoutError):
            await c.segments([{"segment_id": "a"}])
