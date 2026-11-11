"""Contribution-side commands: adapt, create, publish.

These are the flywheel's engine. `search` lets users *draw from* the
database; these let them *fill it*. None of the three is a single API call —
each orchestrates the backend's plan -> execute -> status -> save chain:

    create  = plan -> execute -> poll status -> (offer) save
    adapt   = plan -> fork_and_refine -> execute -> poll status -> (offer) save
    publish = save  (turn a completed plan into a shared process)

`register()` is called from app.py so these share the app's client factory
and error handling rather than duplicating it.
"""

from __future__ import annotations

import time
from typing import Any, Callable, List

import typer

from promptflow_cli.client import ApiError, PromptFlowClient

# Filled in by register().
_console = None
_err = None
_client_factory: Callable[..., PromptFlowClient] = None  # type: ignore
_fail: Callable[[ApiError], None] = None  # type: ignore
_server: Callable[[], str] = None  # type: ignore

# How long to wait for an execution to finish before giving up the poll loop.
_EXECUTE_TIMEOUT_S = 300
_POLL_INTERVAL_S = 3


# Field names /plan accepts as file uploads. Anything else in --input is
# sent as a plain text form field.
_FILE_FIELDS = frozenset((
    "image", "video", "audio",
    "image_2", "image_3", "image_4", "image_5",
    "image_6", "image_7", "image_8", "image_9",
))


def _run_planner(client, text: str, scope: str, files: dict, text_inputs: dict) -> dict:
    """Run the planner, showing live progress when possible.

    Uses the streaming /plan/stream endpoint so the user sees the planner
    working stage by stage. Falls back to the plain /plan call when:
      - there are file inputs (the stream endpoint is text-only), or
      - the streaming endpoint isn't deployed (404).
    Returns the final plan dict either way.
    """
    # File inputs can't go through the text-only stream endpoint.
    if files:
        from promptflow_cli.runtime import activity
        with activity("Analyzing the attached inputs and designing the process"):
            return client.plan(text, scope=scope, files=files, text_inputs=text_inputs)

    from promptflow_cli.progress import consume
    try:
        return consume(client.plan_stream(text, scope=scope, text_inputs=text_inputs), _console)
    except ApiError as exc:
        if getattr(exc, "code", None) == "no_stream":
            from promptflow_cli.runtime import activity
            with activity("Designing the process; this server does not provide stage updates"):
                return client.plan(text, scope=scope, text_inputs=text_inputs)
        raise


def _parse_inputs(raw: List[str]):
    """Turn --input name=value pairs into (files, text_inputs).

    A value is treated as a FILE when its field name is a recognized file
    field (image, audio, video, image_2..9) AND the value points to an
    existing file. Otherwise it is sent as a text form field. This is the
    generic mechanism: the CLI never hard-codes input *types*, it just
    forwards named fields the backend already understands.
    """
    from pathlib import Path

    files: dict = {}
    text_inputs: dict = {}
    for item in raw or []:
        if "=" not in item:
            raise typer.BadParameter(
                f"--input must be name=value (got '{item}'). "
                f"Example: --input image=./photo.png"
            )
        name, value = item.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name or not value:
            raise typer.BadParameter(f"--input has an empty name or value: '{item}'")

        if name in _FILE_FIELDS:
            p = Path(value).expanduser()
            if not p.is_file():
                raise typer.BadParameter(
                    f"--input {name}: file not found: {value}"
                )
            files[name] = p
        else:
            # Unknown field name + a path-like value is probably a mistake.
            text_inputs[name] = value
    return files, text_inputs


def _fail_with_input_hint(exc: ApiError) -> None:
    """Like _fail, but turns a missing-input error into an actionable hint.

    The backend rejects a run before charging when a required file input is
    absent (e.g. an image-generation process with no image). Instead of just
    printing the raw error, tell the user the exact flag to re-run with.
    """
    code = getattr(exc, "code", None)
    if code in ("input_image_missing", "input_video_missing", "input_audio_missing"):
        kind = code.replace("input_", "").replace("_missing", "")
        _err.print(
            f"[yellow]This process needs {kind} input.[/yellow] "
            f"Re-run and attach it with --input:"
        )
        _err.print(f"    [bold]--input {kind}=path/to/your.{_ext_for(kind)}[/bold]")
        _err.print(
            "  [dim]For multiple images use image_2, image_3, … "
            "(e.g. -i image=a.png -i image_2=b.png).[/dim]"
        )
        raise typer.Exit(code=1)
    _fail(exc)


def _ext_for(kind: str) -> str:
    return {"image": "png", "video": "mp4", "audio": "mp3"}.get(kind, "file")


def register(app: typer.Typer, console, err, client_factory, fail, server) -> None:
    """Wire the authoring commands onto the main Typer app."""
    global _console, _err, _client_factory, _fail, _server
    _console, _err = console, err
    _client_factory, _fail, _server = client_factory, fail, server

    app.command()(adapt)
    app.command()(edit)
    app.command()(create)
    app.command()(inspect)
    app.command()(export)
    app.command()(run)
    app.command()(publish)


# ── shared helpers ─────────────────────────────────────────────────────

def _poll_until_done(client: PromptFlowClient, plan_id: str) -> dict:
    """Poll /status until the plan completes, fails, or the timeout hits.

    Also polls /status/steps and prints each step transition, so the
    caller sees which step is running rather than a silent wait.
    """
    deadline = time.monotonic() + _EXECUTE_TIMEOUT_S
    last_status = "running"
    seen_step_status: dict = {}
    while time.monotonic() < deadline:
        time.sleep(_POLL_INTERVAL_S)
        data = client.status(plan_id)
        last_status = str(data.get("status") or "running")

        # Report per-step progress (best-effort — never let it break polling).
        try:
            steps = (client.status_steps(plan_id) or {}).get("steps") or []
            for s in steps:
                sid = s.get("step_id") or f"step {s.get('index')}"
                st = s.get("status")
                if seen_step_status.get(sid) != st:
                    seen_step_status[sid] = st
                    label = {"running": "▸ running", "complete": "✓ done",
                             "failed": "✗ failed", "pending": "· queued"}.get(st, st)
                    typ = s.get("type") or ""
                    if st in ("running", "complete", "failed"):
                        _console.print(f"  [dim]{label}[/dim]  {sid} [dim]({typ})[/dim]")
        except (ApiError, Exception):
            pass  # step detail is a nicety; polling continues regardless

        if last_status in ("complete", "completed", "success"):
            return data
        if last_status in ("failed", "error", "canceled", "cancelled"):
            raise ApiError(
                data.get("message") or f"execution {last_status}",
                code=last_status,
            )
    raise ApiError(f"execution timed out (last status: {last_status})")


def _report_plan(plan_data: dict) -> str | None:
    """Print what the planner decided and return picked_process_id if any.

    This is where the user *sees* the cost saving — the core flywheel
    message: reusing an existing process is cheaper than generating new.
    """
    picked = plan_data.get("picked_process_id")
    cost = plan_data.get("cost")
    plan = plan_data.get("plan") or {}
    steps = plan.get("steps") or []

    if picked:
        _console.print(
            f"  [green]Found a reusable match[/green] — adapting process "
            f"[bold]{picked}[/bold] instead of generating from scratch."
        )
        _console.print("  [dim]Reuse is the cheap path: you pay to adapt, not to build anew.[/dim]")
    else:
        _console.print(
            "  [yellow]No close match in the database[/yellow] — building this one fresh."
        )
        _console.print(
            "  [dim]Once you publish it, the next person with this need reuses yours.[/dim]"
        )
    if isinstance(cost, (int, float)):
        _console.print(f"  Estimated cost: [bold]{cost}[/bold] tokens"
                        + (f" across {len(steps)} steps." if steps else "."))
    return picked


def _offer_publish(process_id: str | None) -> None:
    """After a successful build, nudge the user to publish — flywheel goal #2."""
    _console.print()
    _console.print("  [bold]This process is yours and it works.[/bold] Publishing it:")
    _console.print("    • lets others find and adapt it instead of rebuilding")
    _console.print("    • earns you tokens each time someone runs it")
    if process_id:
        _console.print(
            f'  Publish now:  [bold]promptflow publish --process {process_id}[/bold]'
        )
    else:
        _console.print(
            "  Publish with:  [bold]promptflow publish --process <id>[/bold]"
        )


# ── adapt ──────────────────────────────────────────────────────────────

def adapt(
    request: List[str] = typer.Argument(
        None,
        help='What you want, e.g. "transcribe a podcast and write show notes". '
             'Omit when using --process to target a specific process by id.',
    ),
    instruction: str = typer.Option(
        ...,
        "--change",
        "-c",
        help='The targeted change to apply, e.g. "output French instead of English".',
    ),
    process: str = typer.Option(
        None,
        "--process",
        "-p",
        help="Adapt this exact process id (skips the planner's catalog search). "
             "Use this when you know which process you want to modify.",
    ),
    scope: str = typer.Option(
        "all", "--scope", help='"all" (everyone\'s processes) or "mine".'
    ),
    input: List[str] = typer.Option(
        None, "--input", "-i",
        help="An input the process needs, as name=value. Files: "
             "image/audio/video/image_2..9 (e.g. -i image=./photo.png). "
             "Repeatable.",
    ),
) -> None:
    """Adapt an existing process to a new request.

    Two modes:

    - With --process <id>: target that exact process. The planner is
      forced onto it (no catalog search), then your --change is applied
      via fork-and-refine. This is the "edit this process" path.

    - Without --process: provide a task description as positional args.
      The planner searches the catalog and picks the closest existing
      process, then applies your --change to it.
    """
    client = _client_factory(require_auth=True)

    # Sort --input name=value pairs into file uploads and text fields.
    _files, _texts = _parse_inputs(input)

    if process:
        # Mode A: explicit process id. Skip the catalog search; force the
        # planner onto this process so the snapshot row needed by
        # fork_and_refine gets created. The "instruction" the planner
        # sees is just a marker — the real change goes to fork_and_refine
        # below.
        proc_id = process.strip()
        try:
            meta = client.get_process(proc_id).get("process") or {}
        except ApiError as exc:
            if exc.code == "not_found":
                _err.print(f"[red]✗[/red] No process with id [bold]{proc_id}[/bold].")
                raise typer.Exit(code=1)
            _fail(exc)
        proc_name = meta.get("name") or proc_id
        _console.print(f"  Editing [bold]{proc_name}[/bold] [dim]({proc_id})[/dim]")
        _console.print(f"  Change: [bold]{instruction}[/bold]")
        try:
            plan_data = client.plan(
                f"Modify the existing process '{proc_name}' as described.",
                files=_files, text_inputs=_texts,
                force_process_id=proc_id,
            )
        except ApiError as exc:
            _fail_with_input_hint(exc)
        plan_id = plan_data.get("plan_id")
        if not plan_id:
            _err.print(
                "[red]✗[/red] Could not establish a plan for that process — "
                "the backend did not return a plan_id."
            )
            raise typer.Exit(code=1)
    else:
        # Mode B (original): describe what you want, let the planner pick.
        if not request:
            _err.print(
                "Describe what you want to adapt, or pass --process <id> "
                "to target a specific process."
            )
            raise typer.Exit(code=1)
        text = " ".join(request).strip()
        if not text:
            _err.print("Describe what you want to adapt.")
            raise typer.Exit(code=1)
        _console.print(f'  Planning: [bold]{text}[/bold]')
        try:
            plan_data = _run_planner(client, text, scope, _files, _texts)
        except ApiError as exc:
            _fail_with_input_hint(exc)

        plan_id = plan_data.get("plan_id")
        picked = _report_plan(plan_data)
        if not picked:
            _err.print(
                "\n[yellow]Nothing close enough to adapt.[/yellow] "
                "Run [bold]promptflow create[/bold] to build this from scratch."
            )
            raise typer.Exit(code=1)
        _console.print(f'  Adapting with change: [bold]{instruction}[/bold]')

    try:
        fork = client.fork_and_refine(plan_id, instruction)
    except ApiError as exc:
        _fail(exc)

    _console.print("  [green]✓[/green] Adapted process created.")
    new_id = fork.get("process_id") or fork.get("id")
    if new_id:
        _console.print(f"  New process id: [bold]{new_id}[/bold]")
    _offer_publish(new_id)


# ── edit ───────────────────────────────────────────────────────────────

def edit(
    process_id: str = typer.Argument(
        ..., help="Process id to edit in place (e.g. 3315669d-3874-40)."
    ),
    instruction: str = typer.Option(
        ...,
        "--change",
        "-c",
        help='The change to apply, e.g. "use count=20 in the Brave call instead of looping".',
    ),
) -> None:
    """Edit an owned process in place — same id, same row.

    Unlike `adapt` (which forks), `edit` modifies the process directly.
    Composers that reference this id automatically benefit. If the
    process was published, this auto-de-publishes it: you must re-run
    it successfully and re-publish before it returns to the marketplace.

    Streams Claude's reasoning live during the rewrite, since it's a
    1-2 minute Opus call.
    """
    proc_id = process_id.strip()
    if not proc_id:
        _err.print("Provide a process id to edit.")
        raise typer.Exit(code=1)

    client = _client_factory(require_auth=True)

    # Confirm ownership early with a friendly error; the backend also
    # checks but this gives a faster, clearer message.
    try:
        meta = client.get_process(proc_id).get("process") or {}
    except ApiError as exc:
        if exc.code == "not_found":
            _err.print(f"[red]✗[/red] No process with id [bold]{proc_id}[/bold].")
            raise typer.Exit(code=1)
        _fail(exc)
    if not meta.get("mine"):
        _err.print(
            f"[red]✗[/red] You don't own [bold]{proc_id}[/bold]. "
            "Use [bold]promptflow adapt --process " + proc_id + "[/bold] "
            "to make your own fork instead."
        )
        raise typer.Exit(code=1)
    proc_name = meta.get("name") or proc_id

    _console.print(f"  Editing [bold]{proc_name}[/bold] [dim]({proc_id})[/dim]")
    _console.print(f"  Change: [bold]{instruction}[/bold]")

    # Stream the edit with live thinking display, falling back to the
    # non-streaming endpoint if the stream isn't available.
    from promptflow_cli.progress import consume
    final = None
    try:
        final = consume(client.edit_stream(proc_id, instruction), _console)
    except ApiError as exc:
        if getattr(exc, "code", None) == "no_stream":
            # Fallback to non-streaming
            try:
                final = client.edit(proc_id, instruction)
            except ApiError as e2:
                _fail(e2)
        else:
            _fail(exc)

    if not final or not final.get("ok"):
        msg = (final or {}).get("message") or (final or {}).get("error") or "edit failed"
        _err.print(f"[red]✗[/red] {msg}")
        raise typer.Exit(code=1)

    _console.print(f"  [green]✓[/green] Edit applied to [bold]{proc_id}[/bold].")

    # If the process was published, the edit unpublished it. Be very
    # explicit about this — the owner needs to know their process just
    # left the marketplace listings until they re-verify.
    if final.get("was_published"):
        sample = meta.get("sample_inputs") or {}
        run_cmd = f"promptflow run {proc_id}"
        if isinstance(sample, dict) and sample:
            for k, v in sample.items():
                if v:
                    run_cmd += f' --input {k}="{v}"'
        elif "text" in (meta.get("input_kinds") or []):
            run_cmd += ' --input text="..."'
        _console.print()
        _console.print(
            "  [yellow]⚠[/yellow]  This process was previously published; "
            "the edit unpublished it."
        )
        _console.print(
            "  [dim]To put it back in the marketplace, run it successfully "
            "and re-publish:[/dim]"
        )
        _console.print(f"    [bold]{run_cmd}[/bold]")
        _console.print(f"    [bold]promptflow publish --process {proc_id}[/bold]")
    else:
        _console.print(
            f"  [dim]Test the change:[/dim] [bold]promptflow run {proc_id}[/bold]"
        )


# ── create ─────────────────────────────────────────────────────────────

def create(
    request: List[str] = typer.Argument(..., help="Describe the process you want."),
    scope: str = typer.Option(
        "all", "--scope", help='"all" (everyone\'s processes) or "mine".'
    ),
    commit: bool = typer.Option(
        True,
        "--commit/--no-commit",
        help="For a newly designed process, add it to your catalog right away.",
    ),
    input: List[str] = typer.Option(
        None, "--input", "-i",
        help="An input the process needs, as name=value. Files: "
             "image/audio/video/image_2..9 (e.g. -i image=./photo.png). "
             "Repeatable.",
    ),
) -> None:
    """Create a process to meet a request.

    Plans the request. The planner searches the database first:

      • If your request is genuinely new, it DESIGNS a process. The process
        is created as a draft; `create` then commits it (unless --no-commit)
        so it is live and reusable.

      • If a close existing process fits, the planner picks it and returns
        an executable plan. `create` runs it so the result is ready.

    Either way you end with a working process you can publish.
    """
    text = " ".join(request).strip()
    if not text:
        _err.print("Describe the process you want to create.")
        raise typer.Exit(code=1)

    client = _client_factory(require_auth=True)

    # Sort --input name=value pairs into file uploads and text fields.
    _files, _texts = _parse_inputs(input)

    _console.print(f'  Planning: [bold]{text}[/bold]')
    try:
        plan_data = _run_planner(client, text, scope, _files, _texts)
    except ApiError as exc:
        _fail_with_input_hint(exc)

    intent = str(plan_data.get("intent") or "execute")
    # The planner nests intent/answer inside `plan` on some responses.
    inner = plan_data.get("plan") if isinstance(plan_data.get("plan"), dict) else {}
    if intent in ("", "execute") and inner.get("intent"):
        intent = str(inner.get("intent"))
    # Defensive: a `discuss` intent on the inner plan is authoritative.
    # The planner sometimes returns a discuss answer (e.g. "you already
    # own a process that does this") while the top-level intent field
    # is stale or wrong. Without this, create would try to EXECUTE the
    # discuss plan — which has no executable steps — and hit a confusing
    # downstream error (e.g. fal_result_422). discuss should always win.
    if inner.get("intent") == "discuss":
        intent = "discuss"

    # ── Path 0: the planner answered a question (intent=discuss) ────────
    # Not every request is a process to build. "How do I find papers?"
    # is a question — the planner answers it. A discuss plan is NOT
    # executable; show the answer and stop.
    if intent == "discuss":
        answer = (
            plan_data.get("answer")
            or inner.get("answer")
            or "(no answer returned)"
        )
        _console.print()
        _console.print(answer)
        _console.print()
        _console.print(
            "  [dim]That was a question, so PromptFlow answered it rather "
            "than building a process. To build something runnable, phrase "
            "it as a task — e.g. \"search the web for X and summarize the "
            "results\".[/dim]"
        )
        return

    # ── Path 1: the planner designed a brand-new process ────────────────
    # `/plan` already saved it as a draft. There is no plan_id and no
    # execution — the work is done; we just commit the draft.
    if intent == "design_process":
        proc = plan_data.get("process") or {}
        proc_id = proc.get("id")
        name = proc.get("name") or "Untitled process"
        _console.print(
            f'  [yellow]No close match in the database[/yellow] — '
            f'designed a new process: [bold]{name}[/bold].'
        )
        if proc.get("description"):
            _console.print(f"  [dim]{proc['description']}[/dim]")
        if not proc_id:
            _err.print("[red]✗[/red] The backend designed a process but returned no id.")
            raise typer.Exit(code=1)

        if not commit:
            _console.print()
            _console.print(f"  Saved as a draft. Process id: [bold]{proc_id}[/bold]")
            _console.print("  [dim]It is not in your catalog yet. Commit it when ready.[/dim]")
            return

        try:
            client.commit_draft(proc_id)
        except ApiError as exc:
            _fail(exc)
        _console.print(f"  [green]✓[/green] Committed — [bold]{name}[/bold] is now in your catalog.")
        _console.print(f"  Process id: [bold]{proc_id}[/bold]")

        # Export the process to local files so the user has it on disk —
        # process.py (if it has generated code), prompts/, and metadata.
        folder = None
        py_path = None
        try:
            exp = client.export_process(proc_id)
            files = exp.get("files") or []
            if files:
                slug = "".join(c if c.isalnum() or c in "-_" else "-"
                               for c in (name or proc_id).lower()).strip("-")
                folder = slug or proc_id
                n = _write_bundle(files, folder, _console)
                has_py = any((f.get("path") or "").endswith("process.py")
                             and (f.get("content") or "").strip() for f in files)
                if has_py:
                    py_path = f"{folder}/process.py"
                _console.print()
                _console.print(f"  [bold]Saved {n} files[/bold] to [bold]{folder}/[/bold]")
                if py_path:
                    _console.print(f"  [bold green]→ Python code:[/bold green] [bold]{py_path}[/bold]")
        except ApiError:
            _console.print(
                f"  [dim](Run `promptflow export {proc_id}` to save it to disk.)[/dim]"
            )

        # Report the actual Claude (Anthropic) tokens the planner used —
        # distinct from PromptFlow's internal token cost.
        ct = plan_data.get("claude_tokens") or {}
        if ct.get("input_tokens") is not None:
            tin = int(ct.get("input_tokens") or 0)
            tout = int(ct.get("output_tokens") or 0)
            _console.print(
                f"  [dim]Claude tokens used to design this: "
                f"{tin:,} in + {tout:,} out ({tin + tout:,} total)[/dim]"
            )

        # Show every next step — not just publish. When the planner
        # provided sample input values, show a `run` command that
        # actually works when pasted (with a real example value).
        sample = proc.get("sample_inputs") or plan_data.get("sample_inputs") or {}
        run_cmd = f"promptflow run {proc_id}"
        if isinstance(sample, dict) and sample:
            for k, v in sample.items():
                if v:
                    run_cmd += f' --input {k}="{v}"'
        else:
            # No sample provided — if the process needs a text input,
            # show the flag with a placeholder so it isn't a dead end.
            needs = proc.get("input_kinds") or []
            if "text" in needs:
                run_cmd += ' --input text="..."'

        _console.print()
        _console.print("  [bold]What you can do next:[/bold]")
        _console.print(f"    [bold]promptflow inspect {proc_id}[/bold]   [dim]— see steps, inputs, code[/dim]")
        if isinstance(sample, dict) and sample:
            _console.print(f"    [bold]{run_cmd}[/bold]")
            _console.print(f"      [dim]— run it (example input filled in; edit the value as you like)[/dim]")
        else:
            _console.print(f"    [bold]{run_cmd}[/bold]  [dim]— run it[/dim]")
        _console.print(f"    [bold]promptflow adapt[/bold] [dim]\"<change>\"     — make a modified version[/dim]")
        if py_path:
            _console.print(f"    [dim]open[/dim] [bold]{py_path}[/bold]  [dim]— read/edit the generated code[/dim]")
        _console.print(f"    [bold]promptflow publish --process {proc_id}[/bold]  [dim]— share it, earn tokens[/dim]")
        return

    # ── Path 2: the planner picked an existing process — executable plan ─
    plan_id = plan_data.get("plan_id")
    picked_id = plan_data.get("picked_process_id")
    if not plan_id and not picked_id:
        _err.print("[red]✗[/red] The backend returned an executable intent but no plan id.")
        raise typer.Exit(code=1)

    # If the planner reused an EXISTING process, create's job is done:
    # the process already lives in the catalog and the user can run it
    # themselves with promptflow run. We deliberately do NOT execute it
    # here — `create` should produce a process, not silently run one.
    # Running is `run`'s job, where the user sees cost up-front and can
    # decide whether to spend tokens. Running on reuse used to happen
    # and led to surprise (hidden token spend, hidden long-running
    # work, timeouts on loop-heavy sub-processes).
    if picked_id:
        # Look up the matched process for its sample input + name, so we
        # can show a runnable command instead of a bare id.
        try:
            meta = client.get_process(picked_id).get("process") or {}
        except ApiError:
            meta = {}
        name = meta.get("name") or picked_id
        sample = meta.get("sample_inputs") or {}
        run_cmd = f"promptflow run {picked_id}"
        if isinstance(sample, dict) and sample:
            for k, v in sample.items():
                if v:
                    run_cmd += f' --input {k}="{v}"'
        elif "text" in (meta.get("input_kinds") or []):
            run_cmd += ' --input text="..."'

        _console.print()
        _console.print(
            f"  [bold]Matched an existing process:[/bold] {name} "
            f"[dim]({picked_id})[/dim]"
        )
        _console.print(
            "  [dim]Nothing new was created — this process already exists "
            "in your catalog.[/dim]"
        )
        _console.print()
        _console.print("  [bold]To run it:[/bold]")
        _console.print(f"    [bold]{run_cmd}[/bold]")
        _console.print()
        _console.print(
            f"  [dim]See details:[/dim] [bold]promptflow inspect {picked_id}[/bold]"
        )
        return

    # No picked process — this is a fresh executable plan with no
    # design_process intent. Rare path: the planner produced steps
    # directly without saving them as a process first. We still need to
    # run it to materialize a result, then save the run as a process.
    _report_plan(plan_data)
    if not plan_id:
        _err.print("[red]✗[/red] The backend returned an executable intent but no plan id.")
        raise typer.Exit(code=1)
    _console.print("  Running the plan…")
    try:
        client.execute(plan_id)
        _poll_until_done(client, plan_id)
    except ApiError as exc:
        _fail_with_input_hint(exc)

    _console.print("  [green]\u2713[/green] Process ran successfully.")

    proc_id = None
    try:
        saved = client.save_process(plan_id, text[:120])
        proc_id = saved.get("process_id") or saved.get("id")
        if proc_id:
            _console.print(f"  Saved as a process: [bold]{proc_id}[/bold]")
    except ApiError as exc:
        # Saving is best-effort here; the run still succeeded. Show the
        # reason rather than swallowing it — it is useful diagnostic info.
        _console.print(
            f"  [dim]Run succeeded; could not auto-save as a process "
            f"({exc.code or exc}).[/dim]"
        )
    _offer_publish(proc_id)


# ── publish ────────────────────────────────────────────────────────────

def _write_bundle(files: list, dest_dir, console) -> int:
    """Write bundle files [{path, content}] under dest_dir. Returns count."""
    from pathlib import Path
    base = Path(dest_dir)
    written = 0
    for f in files or []:
        rel = str(f.get("path") or "").lstrip("/")
        if not rel or ".." in rel:
            continue
        target = base / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.get("content") or "", encoding="utf-8")
        written += 1
    return written


def export(
    process_id: str = typer.Argument(..., help="The id of the process to export."),
    out: str = typer.Option(
        None, "--out", "-o",
        help="Destination folder (default: ./<process-name>).",
    ),
) -> None:
    """Export a process to local files — its code, prompts, and metadata.

    Writes the process as a folder: process.py (the generated code, if the
    process has any), prompts/*.txt (each step's prompts as separate files),
    and the .promptflow metadata documents. This is the portable form — the
    process taken out of the backend so you can read, edit, or keep it.
    """
    from pathlib import Path

    client = _client_factory(require_auth=True)
    try:
        result = client.export_process(process_id)
    except ApiError as exc:
        if exc.code == "not_found":
            _err.print(f"[red]✗[/red] No process with id [bold]{process_id}[/bold].")
            raise typer.Exit(code=1)
        _fail(exc)

    files = result.get("files") or []
    if not files:
        _err.print("[yellow]Nothing to export — the process has no files.[/yellow]")
        raise typer.Exit(code=1)

    # Default folder name: try to use the process name.
    if not out:
        try:
            meta = client.get_process(process_id)
            nm = (meta.get("process") or {}).get("name") or process_id
        except ApiError:
            nm = process_id
        slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in nm.lower())
        out = slug.strip("-") or process_id

    n = _write_bundle(files, out, _console)
    _console.print(f"  [green]\u2713[/green] Exported {n} file(s) to [bold]{out}/[/bold]")
    has_py = any((f.get("path") or "").endswith("process.py")
                 and (f.get("content") or "").strip() for f in files)
    if has_py:
        _console.print(f"  [dim]Code:[/dim] {out}/process.py")
    else:
        _console.print(
            "  [dim]This process has no generated Python — it is step "
            "definitions plus the prompt files under prompts/.[/dim]"
        )


def inspect(
    process_id: str = typer.Argument(..., help="The id of the process to inspect."),
    code: bool = typer.Option(
        False, "--code", help="Also print the process's generated code (python_text)."
    ),
) -> None:
    """Show a process in full: inputs, output, steps, requirements, runs.

    Use this to understand what a process needs before running it — what
    inputs to supply, what it produces, and what each step does.
    """
    client = _client_factory(require_auth=True)
    try:
        result = client.get_process(process_id)
    except ApiError as exc:
        if exc.code == "not_found":
            _err.print(f"[red]✗[/red] No process with id [bold]{process_id}[/bold].")
            raise typer.Exit(code=1)
        _fail(exc)

    p = result.get("process") or result
    name = p.get("name") or "(unnamed)"
    _console.print()
    _console.print(f"  [bold]{name}[/bold]   [dim]{p.get('id','')}[/dim]")
    if p.get("description"):
        _console.print(f"  {p['description']}")
    _console.print()

    # State
    flags = []
    if p.get("is_draft"): flags.append("draft (not committed)")
    if p.get("is_published"): flags.append("published")
    if p.get("is_system"): flags.append("system process")
    if p.get("mine"): flags.append("yours")
    _console.print(f"  [dim]State:[/dim] {', '.join(flags) or 'committed, unpublished'}")
    _console.print(f"  [dim]Runs:[/dim]  {p.get('total_runs', 0)}")
    if p.get("is_monetized"):
        _console.print(f"  [dim]Price:[/dim] {p.get('markup_tokens', 0)} tokens per run")

    # Inputs — what you must supply to run it
    kinds = p.get("input_kinds") or []
    _console.print()
    if kinds:
        _console.print(f"  [bold]Inputs required:[/bold] {', '.join(kinds)}")
        for k in kinds:
            if k == "text":
                _console.print("    [dim]· text  — supply with --input text=\"your value\"[/dim]")
            elif k in ("image", "video", "audio"):
                _console.print(f"    [dim]· {k}  — supply with --input {k}=path/to/file[/dim]")
            else:
                _console.print(f"    [dim]· {k}[/dim]")
    else:
        _console.print("  [bold]Inputs required:[/bold] none")

    # Output
    _console.print(f"  [bold]Produces:[/bold] {p.get('output_kind') or 'unknown'}")

    # Steps — what it does
    steps = p.get("steps") or []
    _console.print()
    if steps:
        _console.print(f"  [bold]Steps ({len(steps)}):[/bold]")
        for i, s in enumerate(steps, 1):
            stype = s.get("type") or "?"
            if stype == "recipe":
                detail = s.get("recipe_id") or s.get("model") or "recipe"
            elif stype == "claude":
                detail = "Claude prompt step"
            elif stype == "process":
                detail = f"calls process {s.get('process_id','?')}"
            else:
                detail = stype
            _console.print(f"    {i}. \\[{stype}] {detail}")
    else:
        _console.print("  [bold]Steps:[/bold] none recorded")

    # Generated code
    py = p.get("python_text")
    _console.print()
    if py and py.strip():
        if code:
            _console.print("  [bold]Generated code (python_text):[/bold]")
            _console.print()
            for line in py.splitlines():
                _console.print(f"    {line}")
        else:
            _console.print(
                f"  [bold]Generated code:[/bold] {len(py.splitlines())} lines "
                f"stored on the process — run with [bold]--code[/bold] to print it."
            )
    else:
        _console.print(
            "  [bold]Generated code:[/bold] none — this process is its step "
            "definitions (prompts + recipe calls), not a separate code file."
        )
    _console.print()
    _console.print(f"  [dim]Run it:[/dim]     promptflow run {p.get('id','')}")
    _console.print(f"  [dim]Publish it:[/dim] promptflow publish --process {p.get('id','')}")


def run(
    process_id: str = typer.Argument(..., help="Downloaded .promptflow file, extracted bundle folder, or server process id."),
    input: List[str] = typer.Option(
        None, "--input", "-i",
        help="An input the process needs, as name=value. Text inputs: "
             "text=\"your value\". Files: image=path. Repeatable. "
             "Run `promptflow inspect <id>` first to see required inputs.",
    ),
    text: str = typer.Option(None, "--text", "-t", help="Text input for a downloaded bundle or process."),
    check: bool = typer.Option(False, "--check", help="Check a local bundle without provider calls."),
    output_dir: str = typer.Option("promptflow-output", "--output-dir", help="Local result directory."),
    model: str = typer.Option(None, "--model", help="AI text model override for this run."),
    instructions: str = typer.Option(None, "--instructions", help="Generate or research inputs before running."),
    name: str = typer.Option(None, "--name", help="Descriptive name for this run."),
    max_run_tokens: int = typer.Option(None, "--max-run-tokens", min=0, max=1000000, help="Maximum hosted compute credits; excludes creator fees and provider bills."),
    max_output_tokens: int = typer.Option(4096, "--max-output-tokens", min=256, max=8192, help="Output-token limit per local AI call."),
    yes: bool = typer.Option(
        False, "--yes", "-y",
        help="Skip the cost confirmation prompt (for scripting).",
    ),
) -> None:
    """Run a downloaded bundle locally, or a process id on the server.

    Builds an execution plan for this exact process (with your inputs),
    runs it, and shows the result. Provider compute can cost tokens even for your own process.
    A successful run also satisfies the publish quality gate.

        promptflow inspect <id>     # see what inputs it needs
        promptflow run <id> -i text="quantum computing"
        promptflow publish --process <id>
    """
    from pathlib import Path
    from promptflow_cli.local import execute_bundle
    target = Path(process_id).expanduser()
    if target.exists() or process_id.lower().endswith(".promptflow"):
        if max_run_tokens is not None: raise typer.BadParameter("--max-run-tokens caps hosted credits. Local runs use provider billing; use --model and --max-output-tokens.")
        raise typer.Exit(execute_bundle(target, input or [], text, check, output_dir, model, instructions, name, yes, max_output_tokens))
    if check or output_dir != "promptflow-output" or max_output_tokens != 4096:
        raise typer.BadParameter("--check, --max-output-tokens and --output-dir apply to downloaded bundles. Hosted output limits are set in Model & API access.")
    input = list(input or [])
    if text is not None: input.append("text=" + text)
    client = _client_factory(require_auth=True)

    # Learn what the process needs, so we can guide the user.
    try:
        meta = client.get_process(process_id)
    except ApiError as exc:
        if exc.code == "not_found":
            _err.print(f"[red]✗[/red] No process with id [bold]{process_id}[/bold].")
            raise typer.Exit(code=1)
        _fail(exc)
    proc = meta.get("process") or meta
    needed = proc.get("input_kinds") or []

    _files, _texts = _parse_inputs(input)
    # The planner needs a text instruction; use the supplied text input,
    # or the process description as a sensible default.
    instruction = _texts.get("text") or proc.get("description") or "Run this process."

    # If the process needs a text input and none was given, ask for it.
    if "text" in needed and "text" not in _texts and not instructions:
        _err.print(
            f"[yellow]This process needs a text input.[/yellow] "
            f"Re-run with:  promptflow run {process_id} -i text=\"your value\""
        )
        raise typer.Exit(code=1)

    _console.print(f"  Running [bold]{proc.get('name') or process_id}[/bold]…")
    if instructions: _texts["run_instructions"] = instructions
    else: _texts["input_mode"] = "data"
    if name: _texts["run_name"] = name
    if model: _texts["text_model"] = model
    if max_run_tokens is not None: _texts["max_run_tokens"] = str(max_run_tokens)

    # Build an execute plan constrained to THIS process, then run it.
    try:
        from promptflow_cli.runtime import activity
        with activity('Planning input preparation' if instructions else 'Checking the saved workflow and its cost'):
            plan_data = client.plan(
                _texts.get("text", "") if instructions else instruction, files=_files, text_inputs=_texts,
                force_process_id=process_id,
            )
    except ApiError as exc:
        _fail_with_input_hint(exc)

    plan_id = plan_data.get("plan_id")
    if not plan_id:
        _err.print(
            "[red]✗[/red] Could not build an execution plan for this process."
        )
        raise typer.Exit(code=1)

    # Show the token cost BEFORE running, so there are no surprises.
    cost = plan_data.get("cost") or {}
    if (plan_data.get("plan") or {}).get("run_name"):
        _console.print("  Run: " + plan_data["plan"]["run_name"], markup=False)
    charge = cost.get("tokens_charged")
    owner = bool(proc.get("mine"))
    if isinstance(charge, (int, float)) and charge > 0:
        _console.print(f"  [bold]Cost to run: {int(charge)} tokens.[/bold]")
    else:
        _console.print("  [dim]No positive token estimate was returned; check provider costs.[/dim]")

    # Plan steps preview — what this run will do.
    plan_steps = (plan_data.get("plan") or {}).get("steps") or []
    if isinstance(plan_steps, list) and plan_steps:
        labels = []
        for s in plan_steps:
            t = s.get("type") if isinstance(s, dict) else None
            if t == "recipe":
                labels.append(s.get("recipe_id") or s.get("model") or "recipe")
            elif t == "claude":
                labels.append("AI step")
            elif t == "process":
                labels.append("sub-process")
            elif t:
                labels.append(t)
        if labels:
            _console.print(f"  [dim]Steps: {' → '.join(labels)}[/dim]")

    # Confirm before spending tokens (skip with --yes, or when free).
    if not yes and isinstance(charge, (int, float)) and charge > 0:
        if not typer.confirm(f"  Run for {int(charge)} tokens?", default=True):
            _console.print("  [dim]Cancelled — nothing was charged.[/dim]")
            raise typer.Exit(code=0)

    _console.print("  [dim]· executing…[/dim]")
    try:
        client.execute(plan_id)
        final = _poll_until_done(client, plan_id)
    except ApiError as exc:
        _fail_with_input_hint(exc)

    _console.print("  [green]\u2713[/green] Ran successfully.")

    # Show the output. /status returns `outputs` — an array of
    # {step_id, kind, url, text?}. Text-producing processes (web search,
    # analysis) carry their result in `text`; media processes carry a url.
    outputs = (final or {}).get("outputs") or []
    if not isinstance(outputs, list):
        outputs = []
    shown = False
    for o in outputs:
        if not isinstance(o, dict):
            continue
        text_out = o.get("text")
        url_out = o.get("url")
        if text_out and str(text_out).strip():
            _console.print()
            _console.print(str(text_out).rstrip())
            shown = True
        elif url_out and str(url_out).strip():
            kind = o.get("kind") or "file"
            _console.print()
            _console.print(f"  [bold]{kind}:[/bold] {url_out}")
            shown = True
    if shown:
        _console.print()
    else:
        # Completed but nothing surfaced — tell the user plainly rather
        # than silently showing nothing.
        _console.print(
            "  [dim]The process completed but returned no displayable "
            "output. Use `promptflow inspect` to check its steps.[/dim]"
        )

    # Record the run against the process (satisfies the publish gate).
    try:
        client.use_process(process_id, plan_id=plan_id)
    except ApiError:
        pass  # the run itself succeeded; recording is best-effort

    _console.print(
        f"  [dim]Run recorded — publish with: "
        f"promptflow publish --process {process_id}[/dim]"
    )


def publish(
    process_id: str = typer.Option(
        ..., "--process", "-p", help="The process id from `create` or `adapt`."
    ),
    price: int = typer.Option(
        0, "--price", help="Token markup others pay per run (0 = free to run)."
    ),
    bonus: int = typer.Option(
        0, "--bonus", help="Optional quality-bonus tokens you receive per run."
    ),
) -> None:
    """Publish a process to the shared marketplace.

    This is the contribution half of the flywheel: a published process is
    discoverable by everyone, so the next person with this need finds yours
    instead of paying to regenerate it — and you earn when they run it.

    The backend requires the process to have run successfully at least once
    before its first publish (a quality floor). If you see that message,
    run it once, then publish.
    """
    client = _client_factory(require_auth=True)

    if price < 0 or bonus < 0:
        _err.print("Price and bonus must be zero or positive.")
        raise typer.Exit(code=1)

    _console.print(f"  Publishing process [bold]{process_id}[/bold]…")
    try:
        result = client.monetize(
            process_id, monetized=True, markup_tokens=price, bonus_tokens=bonus
        )
    except ApiError as exc:
        if exc.code == "needs_test_run":
            _err.print(
                "[yellow]Not yet.[/yellow] The backend requires one successful run "
                "before a process can be published — a quality floor."
            )
            _err.print(
                "  Run it once first:  [bold]promptflow run "
                + process_id + "[/bold]"
            )
            raise typer.Exit(code=1)
        if exc.code == "forbidden":
            _err.print("[red]✗[/red] You can only publish a process you created.")
            raise typer.Exit(code=1)
        _fail(exc)

    _console.print("  [green]✓[/green] Published to the marketplace.")
    if price:
        _console.print(f"  Others pay [bold]{price}[/bold] tokens per run; that goes to you.")
    else:
        _console.print("  It is free to run — good for getting early usage and feedback.")
    _console.print(
        "  [dim]It is now discoverable: others can search, run, and adapt it.[/dim]"
    )
