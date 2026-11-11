"""HTTP client for the PromptFlow backend.

Every method here maps to a route verified to exist in the deployed
`promptflow_routes.ts`. The backend's conventions, which this client relies
on uniformly:

  - Auth is `Authorization: Bearer pf_live_...` for everything that needs a
    user. Public reads work anonymously.
  - Responses are JSON with an `{ "ok": true | false, ... }` envelope.
    `ok: false` carries an `error` code and sometimes a `message`.
  - `/plan` is the one multipart/form-data endpoint; everything else is JSON.

The client raises `ApiError` for transport failures and `{ok: false}`
responses, and `AuthRequired` specifically for 401s so the CLI can tell the
user to run `promptflow login`.
"""

from __future__ import annotations

import mimetypes
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

import httpx


def _guess_content_type(path: Path) -> str:
    """Best-effort MIME type for an upload part; the backend re-checks anyway."""
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        return guessed
    # Sensible fallbacks by extension for the kinds /plan accepts.
    ext = path.suffix.lower().lstrip(".")
    return {
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "webp": "image/webp", "gif": "image/gif",
        "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4",
        "mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm",
    }.get(ext, "application/octet-stream")


class ApiError(RuntimeError):
    """A backend call failed — transport error or an {ok: false} response."""

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


class AuthRequired(ApiError):
    """The endpoint needs a logged-in user and none was provided / the key was bad."""


def stream_events(lines):
    """Parse complete SSE frames; never expose legacy model deliberation."""
    event, data = 'message', []
    for line in lines:
        if line == '':
            if data:
                if event == 'thinking': payload = {}
                else:
                    try: payload = json.loads('\n'.join(data))
                    except ValueError: raise ApiError('The server sent an invalid progress event.') from None
                yield event, payload
                if event in ('done', 'error'): return
            event, data = 'message', []
        elif line.startswith('event:'): event = line[6:].strip()
        elif line.startswith('data:'): data.append(line[5:].lstrip(' '))


class PromptFlowClient:
    """Thin, typed wrapper over the PromptFlow HTTP API."""

    def __init__(self, server: str, api_key: Optional[str] = None, timeout: float = 60.0):
        self.server = server.rstrip("/")
        self.api_key = api_key
        self._timeout = timeout
        # /plan runs the planner (Opus + thinking + web search) and can
        # legitimately take a couple of minutes on a novel design request.
        # A short timeout here kills requests the backend would have
        # completed, so planning gets its own generous ceiling.
        self._plan_timeout = max(timeout, 240.0)

    # -- internals ---------------------------------------------------------

    def _headers(self, anonymous: bool = False) -> Dict[str, str]:
        h = {"accept": "application/json"}
        if not anonymous and self.api_key:
            h["authorization"] = f"Bearer {self.api_key}"
        return h

    def _url(self, path: str) -> str:
        return f"{self.server}{path}"

    def _unwrap(self, resp: httpx.Response) -> Dict[str, Any]:
        """Turn an HTTP response into a data dict, or raise the right error."""
        if resp.status_code == 401:
            raise AuthRequired(
                "Not signed in. Run `promptflow login` first.",
                code="not_logged_in",
                status=401,
            )
        try:
            data = resp.json()
        except ValueError:
            raise ApiError(
                f"Backend returned non-JSON ({resp.status_code}) for {resp.request.url.path}.",
                status=resp.status_code,
            )
        if isinstance(data, dict) and data.get("ok") is False:
            raise ApiError(
                data.get("message") or data.get("error") or "request failed",
                code=data.get("error"),
                status=resp.status_code,
            )
        if resp.status_code >= 400:
            raise ApiError(f"HTTP {resp.status_code}", status=resp.status_code)
        return data if isinstance(data, dict) else {"data": data}

    def _post_json(
        self, path: str, payload: Dict[str, Any],
        anonymous: bool = False, timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        try:
            with httpx.Client(timeout=timeout if timeout is not None else self._timeout) as c:
                r = c.post(self._url(path), json=payload, headers=self._headers(anonymous))
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")
        return self._unwrap(r)

    def _get(self, path: str, anonymous: bool = False) -> Dict[str, Any]:
        try:
            with httpx.Client(timeout=self._timeout) as c:
                r = c.get(self._url(path), headers=self._headers(anonymous))
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")
        return self._unwrap(r)

    # -- identity ----------------------------------------------------------

    def list_api_keys(self) -> Dict[str, Any]:
        """GET /me/api_keys — also doubles as a cheap 'is my key valid' probe."""
        return self._get("/api/promptflow/me/api_keys")

    # -- device login -----------------------------------------------------

    def device_start(self, client_label: str | None = None) -> Dict[str, Any]:
        """POST /device/start — begin a browser-approved login. Anonymous."""
        return self._post_json(
            "/api/promptflow/device/start",
            {"client_label": client_label or ""},
            anonymous=True,
        )

    def device_poll(self, device_code: str) -> Dict[str, Any]:
        """POST /device/poll — check whether the user has approved yet. Anonymous."""
        return self._post_json(
            "/api/promptflow/device/poll",
            {"device_code": device_code},
            anonymous=True,
        )

    # -- discovery --------------------------------------------------------

    def search(self, query: str) -> Dict[str, Any]:
        """POST /search — agentic retrieval over the process database.

        Returns the backend's debug-mode result: shortlist with score
        breakdowns, token usage, and timings. Requires login.
        """
        return self._post_json("/api/promptflow/search", {"query": query})

    def list_processes(self) -> Dict[str, Any]:
        """GET /processes — the catalog visible to the caller (yours + public)."""
        return self._get("/api/promptflow/processes")

    def get_process(self, process_id: str) -> Dict[str, Any]:
        """POST /process/get — full detail for a single process."""
        return self._post_json("/api/promptflow/process/get", {"id": process_id})

    def export_process(self, process_id: str) -> Dict[str, Any]:
        """GET /process/bundle?format=json — the process as a set of files.

        Returns {ok, files:[{path, content}]} — process.py (the generated
        code, if any), prompts/*.txt (each step's prompts), and the
        .promptflow metadata docs. This is the portable form of a process.
        """
        from urllib.parse import quote
        url = self._url(
            f"/api/promptflow/process/bundle?format=json&id={quote(process_id)}"
        )
        try:
            with httpx.Client(timeout=self._timeout) as c:
                r = c.get(url, headers=self._headers())
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")
        return self._unwrap(r)

    # -- planning / creation ---------------------------------------------

    # Multipart field names the /plan endpoint recognizes for file inputs.
    # Anything else passed as an input is sent as a plain text form field.
    PLAN_FILE_FIELDS = (
        "image", "video", "audio",
        "image_2", "image_3", "image_4", "image_5",
        "image_6", "image_7", "image_8", "image_9",
    )
    # Per-file size ceilings the backend enforces (bytes).
    PLAN_MAX_IMAGE_AUDIO = 12 * 1024 * 1024
    PLAN_MAX_VIDEO = 200 * 1024 * 1024

    def plan_stream(self, text: str, scope: str = "all", text_inputs=None):
        """POST /plan/stream — run the planner, yielding live progress events.

        Yields (event_name, data) tuples as the backend emits them:
          - ("stage", {stage, message})  — a named pipeline stage started
          - ("heartbeat", {seconds})     — still working, connection alive
          - ("done", {ok, plan, intent}) — the finished plan
          - ("error", {error, message}) — planning failed

        This is the responsive path: the connection streams continuously
        so it neither times out nor leaves the user staring at silence.
        Falls back is the caller's job — if the stream endpoint is absent,
        the caller can use plan() instead.
        """
        # Force multipart, same reason as plan().
        parts = {"_": ("", b"", "application/octet-stream")}
        data = {**(text_inputs or {}), "text": text, "scope": scope}
        try:
            with httpx.Client(timeout=self._plan_timeout) as c:
                with c.stream(
                    "POST",
                    self._url("/api/promptflow/plan/stream"),
                    data=data,
                    files=parts,
                    headers=self._headers(),
                ) as r:
                    if r.status_code == 401:
                        raise AuthRequired(
                            "Not signed in. Run `promptflow login` first.",
                            code="not_logged_in", status=401,
                        )
                    if r.status_code == 404:
                        # Streaming endpoint not deployed — signal the caller
                        # so it can fall back to the non-streaming plan().
                        raise ApiError("plan/stream not available", code="no_stream", status=404)
                    if r.status_code >= 400:
                        raise ApiError(f"HTTP {r.status_code}", status=r.status_code)

                    yield from stream_events(r.iter_lines())
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")

    def plan(
        self,
        text: str,
        scope: str = "all",
        files: Optional[Dict[str, "os.PathLike"]] = None,
        text_inputs: Optional[Dict[str, str]] = None,
        force_process_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /plan — turn a request into a plan (this runs search+compose).

        The one multipart/form-data endpoint. `scope` is "all" (default) or
        "mine". `files` maps a recognized field name (image, audio, video,
        image_2..image_9) to a local file path — attached as a file part.
        `text_inputs` maps any other field name to a string value.

        `force_process_id` constrains the planner to build an execute plan
        for that exact existing process (used by `run`). The response
        includes `plan_id`, `plan`, `cost`, and `picked_process_id`.
        """
        data: Dict[str, Any] = {"text": text, "scope": scope}
        if text_inputs:
            data.update(text_inputs)
        if force_process_id:
            data["force_process_id"] = force_process_id

        file_parts: Dict[str, Any] = {}
        opened: list = []
        try:
            if files:
                for field, path in files.items():
                    p = Path(path)
                    if not p.is_file():
                        raise ApiError(f"Input file not found: {path}")
                    size = p.stat().st_size
                    limit = (
                        self.PLAN_MAX_VIDEO
                        if field == "video"
                        else self.PLAN_MAX_IMAGE_AUDIO
                    )
                    if size > limit:
                        raise ApiError(
                            f"{p.name} is {size // (1024*1024)} MB — the limit "
                            f"for '{field}' is {limit // (1024*1024)} MB."
                        )
                    fh = p.open("rb")
                    opened.append(fh)
                    file_parts[field] = (p.name, fh, _guess_content_type(p))
            try:
                with httpx.Client(timeout=self._plan_timeout) as c:
                    # /plan is a multipart/form-data endpoint. httpx only
                    # sends multipart when `files` is non-empty, so when
                    # there are no real file parts we pass a tiny dummy
                    # part to force multipart encoding — otherwise httpx
                    # sends url-encoded and the endpoint may not parse it.
                    parts = file_parts or {"_": ("", b"", "application/octet-stream")}
                    r = c.post(
                        self._url("/api/promptflow/plan"),
                        data=data,
                        files=parts,
                        headers=self._headers(),
                    )
            except httpx.HTTPError as exc:
                raise ApiError(f"Could not reach {self.server}: {exc}")
        finally:
            for fh in opened:
                try:
                    fh.close()
                except OSError:
                    pass
        return self._unwrap(r)

    def execute(self, plan_id: str) -> Dict[str, Any]:
        """POST /execute — start running a plan (charges tokens)."""
        return self._post_json("/api/promptflow/execute", {"plan_id": plan_id})

    def status(self, plan_id: str) -> Dict[str, Any]:
        """POST /status — poll execution progress for a plan."""
        return self._post_json("/api/promptflow/status", {"plan_id": plan_id})

    def status_steps(self, plan_id: str) -> Dict[str, Any]:
        """POST /status/steps — lightweight per-step progress for a plan.

        Returns {steps:[{index, step_id, type, status, error}]} without
        driving the executor. Used to show live step-by-step progress.
        """
        return self._post_json("/api/promptflow/status/steps", {"plan_id": plan_id})

    # -- adaptation -------------------------------------------------------

    def fork_and_refine(self, plan_id: str, instruction: str) -> Dict[str, Any]:
        """POST /process/fork_and_refine — adapt the process attached to a plan.

        The backend forks the process the plan was built from and applies
        `instruction` as a targeted edit. Requires that the plan was built
        from an existing saved process (i.e. the planner picked one).

        Uses the long (plan) timeout, not the default — this endpoint
        makes an Opus call to rewrite the process, which can take a
        couple of minutes on a non-trivial change. The default 60s
        timeout kills requests the backend would have completed.
        """
        return self._post_json(
            "/api/promptflow/process/fork_and_refine",
            {"plan_id": plan_id, "instruction": instruction},
            timeout=self._plan_timeout,
        )

    def edit_stream(self, process_id: str, instruction: str):
        """POST /process/edit/stream — in-place edit, yielding live progress.

        Yields (event_name, data) tuples as the backend emits them:
          - ("stage", {stage})           — coarse phase marker
          - ("heartbeat", {seconds})    — elapsed time while work continues
          - ("done", <result dict>)      — finished edit, includes
                                            was_published, name, etc.
          - ("error", {message})         — edit failed

        Uses the plan-timeout for the HTTP read since the backend Opus
        call can run 1-2 minutes; the SSE connection stays open the
        whole time.
        """
        payload = {"process_id": process_id, "instruction": instruction}
        try:
            with httpx.Client(timeout=self._plan_timeout) as c:
                with c.stream(
                    "POST",
                    self._url("/api/promptflow/process/edit/stream"),
                    json=payload,
                    headers=self._headers(),
                ) as r:
                    if r.status_code == 401:
                        raise AuthRequired(
                            "Not signed in. Run `promptflow login` first.",
                            code="not_logged_in", status=401,
                        )
                    if r.status_code == 404:
                        raise ApiError("edit/stream not available", code="no_stream", status=404)
                    if r.status_code >= 400:
                        raise ApiError(f"HTTP {r.status_code}", status=r.status_code)
                    yield from stream_events(r.iter_lines())
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")

    def edit(self, process_id: str, instruction: str) -> Dict[str, Any]:
        """POST /process/edit — non-streaming fallback.

        For callers that don't want the live activity display. Same
        contract, single response.
        """
        return self._post_json(
            "/api/promptflow/process/edit",
            {"process_id": process_id, "instruction": instruction},
            timeout=self._plan_timeout,
        )

    # -- bundle upload / contribution ------------------------------------

    # Backend limits, mirrored here so the CLI can fail fast with a clear
    # message instead of uploading megabytes only to get a 413.
    UPLOAD_MAX_BYTES = 10 * 1024 * 1024        # whole zip
    UPLOAD_MAX_FILES = 100
    UPLOAD_MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024

    def upload_contribute(
        self, zip_bytes: bytes, title: str, chat_bytes: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """POST /upload/contribute — upload a zipped bundle (multipart/form-data).

        `zip` is required; `chat` is optional context. Returns an upload_id.
        """
        files: Dict[str, Any] = {
            "zip": ("bundle.zip", zip_bytes, "application/zip"),
        }
        if chat_bytes is not None:
            files["chat"] = ("chat.txt", chat_bytes, "text/plain")
        try:
            with httpx.Client(timeout=self._timeout) as c:
                r = c.post(
                    self._url("/api/promptflow/upload/contribute"),
                    data={"title": title},
                    files=files,
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            raise ApiError(f"Could not reach {self.server}: {exc}")
        return self._unwrap(r)

    def upload_extract(self, upload_id: str) -> Dict[str, Any]:
        """POST /upload/extract — distill an uploaded bundle into a process."""
        return self._post_json(
            "/api/promptflow/upload/extract", {"upload_id": upload_id}
        )

    def upload_status(self, upload_id: str) -> Dict[str, Any]:
        """GET /upload/:id/status — poll extraction progress."""
        return self._get(f"/api/promptflow/upload/{upload_id}/status")

    # -- running a process ------------------------------------------------

    def use_process(self, process_id: str, plan_id: Optional[str] = None) -> Dict[str, Any]:
        """POST /process/use — run an existing process by id.

        Records a run against the process (writes a promptflow_process_runs
        row) and bumps its run counter. Running a process you own is free;
        running someone else's debits tokens per its cascade pricing.

        This is also what satisfies the publish quality gate — a process
        must have at least one recorded run before it can be published.
        """
        payload: Dict[str, Any] = {"id": process_id}
        if plan_id:
            payload["plan_id"] = plan_id
        return self._post_json("/api/promptflow/process/use", payload)

    # -- design-path drafts ----------------------------------------------

    def commit_draft(self, process_id: str) -> Dict[str, Any]:
        """POST /process/commit_draft — promote a designed draft into the catalog.

        When `/plan` returns intent="design_process", the new process is
        already saved but flagged is_draft=1, so it does not yet appear in
        the planner's catalog. Committing flips that flag — the process
        becomes selectable for future runs and discoverable by others.
        """
        return self._post_json(
            "/api/promptflow/process/commit_draft",
            {"process_id": process_id},
        )

    def discard_draft(self, process_id: str) -> Dict[str, Any]:
        """POST /process/discard_draft — delete a designed draft you don't want."""
        return self._post_json(
            "/api/promptflow/process/discard_draft",
            {"process_id": process_id},
        )

    # -- publishing -------------------------------------------------------

    def monetize(
        self,
        process_id: str,
        monetized: bool = True,
        markup_tokens: int = 0,
        bonus_tokens: int = 0,
    ) -> Dict[str, Any]:
        """POST /process/monetize — publish a process to the marketplace.

        This is the real "publish": it flips the process to published/
        discoverable and sets its per-run pricing. The backend requires the
        process to have one successful run before its first publish — that
        surfaces as the `needs_test_run` error code.
        """
        return self._post_json(
            "/api/promptflow/process/monetize",
            {
                "id": process_id,
                "monetized": monetized,
                "markup_tokens": markup_tokens,
                "bonus_tokens": bonus_tokens,
            },
        )

    def save_process(self, plan_id: str, name: str, description: str = "") -> Dict[str, Any]:
        """POST /process/save — turn a completed (executed) plan into a process.

        Used for the EXECUTE path: a plan that ran to completion is saved as
        a reusable process. The design path does not use this — there the
        process is created by `/plan` itself and promoted via commit_draft.
        """
        return self._post_json(
            "/api/promptflow/process/save",
            {"plan_id": plan_id, "name": name, "description": description},
        )
