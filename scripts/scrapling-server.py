"""Scrapling HTTP scraping service.

Thin FastAPI wrapper around Scrapling's fetchers for use as an OpenClaw
web-fetch backend.  Exposes two endpoints:

  GET  /health          – healthcheck
  POST /fetch           – fetch a URL with optional stealth mode

Stealth fetches use Scrapling's StealthyFetcher (Playwright-based
anti-bot bypass).  A semaphore limits concurrent stealth requests to
avoid OOM from multiple headless Chromium instances.

Environment variables:
  SCRAPLING_STEALTH_CONCURRENCY  – max concurrent stealth fetches (default: 5)
  SCRAPLING_TIMEOUT              – per-request timeout in seconds (default: 30)

Credit: Scrapling by D4Vinci — https://github.com/D4Vinci/Scrapling
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl, field_validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scrapling-server")

app = FastAPI(title="Scrapling Fetch Service", version="1.0.0")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STEALTH_CONCURRENCY = int(os.environ.get("SCRAPLING_STEALTH_CONCURRENCY", "5"))
DEFAULT_TIMEOUT = int(os.environ.get("SCRAPLING_TIMEOUT", "30"))
MAX_TIMEOUT = 120  # Hard ceiling to prevent resource exhaustion

_stealth_semaphore = asyncio.Semaphore(STEALTH_CONCURRENCY)

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class FetchRequest(BaseModel):
    url: HttpUrl
    mode: str = "markdown"  # "markdown" or "text"
    stealth: bool = False  # Use StealthyFetcher for anti-bot bypass
    timeout: Optional[int] = None  # Per-request timeout override

    @field_validator("timeout")
    @classmethod
    def clamp_timeout(cls, v: Optional[int]) -> Optional[int]:
        if v is not None:
            return max(1, min(v, MAX_TIMEOUT))
        return v


class FetchResponse(BaseModel):
    url: str
    finalUrl: Optional[str] = None
    status: Optional[int] = None
    title: Optional[str] = None
    text: str
    extractor: str = "scrapling"
    tookMs: int = 0
    stealth: bool = False


# ---------------------------------------------------------------------------
# Shared extraction helper
# ---------------------------------------------------------------------------


def _extract_page_content(page) -> dict:
    """Extract text and title from a Scrapling page response.

    Returns dict with keys: text, title, status, finalUrl.
    """
    if not page:
        return {"text": "", "title": None, "status": None, "finalUrl": None}

    text = ""
    title = None

    body = page.css("body")
    if body:
        text = body[0].get_all_text(separator="\n", strip=True)

    title_el = page.css("title")
    if title_el:
        title = title_el[0].text

    return {
        "text": text,
        "title": title,
        "status": getattr(page, "status_code", None),
        "finalUrl": getattr(page, "url", None),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok", "service": "scrapling", "stealth_concurrency": STEALTH_CONCURRENCY}


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(req: FetchRequest):
    url_str = str(req.url)
    timeout = min(req.timeout or DEFAULT_TIMEOUT, MAX_TIMEOUT)
    start = time.monotonic()

    try:
        if req.stealth:
            async with _stealth_semaphore:
                result = await _stealth_fetch(url_str, timeout)
        else:
            result = await _basic_fetch(url_str, timeout)
    except asyncio.TimeoutError:
        logger.warning("Fetch timed out for %s (timeout=%ds, stealth=%s)", url_str, timeout, req.stealth)
        raise HTTPException(status_code=504, detail=f"Fetch timed out after {timeout}s")
    except Exception as exc:
        logger.error("Fetch failed for %s: %s (stealth=%s)", url_str, exc, req.stealth, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc))

    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info("Fetched %s in %dms (stealth=%s, status=%s)", url_str, elapsed_ms, req.stealth, result.get("status"))
    return FetchResponse(
        url=url_str,
        finalUrl=result.get("finalUrl"),
        status=result.get("status"),
        title=result.get("title"),
        text=result.get("text", ""),
        extractor="scrapling-stealth" if req.stealth else "scrapling",
        tookMs=elapsed_ms,
        stealth=req.stealth,
    )


# ---------------------------------------------------------------------------
# Fetch implementations
# ---------------------------------------------------------------------------


async def _basic_fetch(url: str, timeout: int) -> dict:
    """Fast HTTP-only fetch using Scrapling's Fetcher."""
    from scrapling.fetchers import Fetcher

    loop = asyncio.get_running_loop()
    page = await asyncio.wait_for(
        loop.run_in_executor(
            None,
            lambda: Fetcher().fetch(url, timeout=timeout),
        ),
        timeout=timeout + 5,
    )
    return _extract_page_content(page)


async def _stealth_fetch(url: str, timeout: int) -> dict:
    """Stealth fetch using Scrapling's StealthyFetcher (Playwright + anti-bot bypass)."""
    from scrapling.fetchers import StealthyFetcher

    loop = asyncio.get_running_loop()
    page = await asyncio.wait_for(
        loop.run_in_executor(
            None,
            lambda: StealthyFetcher().fetch(
                url,
                headless=True,
                network_idle=True,
                timeout=timeout * 1000,  # Playwright uses milliseconds
            ),
        ),
        timeout=timeout + 10,
    )
    return _extract_page_content(page)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8765)
