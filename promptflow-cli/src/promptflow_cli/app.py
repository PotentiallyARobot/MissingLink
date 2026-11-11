"""The `promptflow` CLI.

MVP command surface (the flywheel):

    promptflow login              authenticate this device via the browser
    promptflow logout             remove the stored key
    promptflow whoami             show who you are signed in as
    promptflow search "<query>"   search the process database
    promptflow adapt   ...        adapt an existing process to a new request
    promptflow create  "<req>"    create a process (adapts a match, or builds new)
    promptflow publish ...        publish a process so others can find it

`login` and the discovery commands form the consumption side; `create`,
`adapt`, and `publish` form the contribution side. Both halves are needed
for the flywheel — consumers draw the database down, publishers fill it.

This file wires `login`/`logout`/`whoami`/`search`. The contribution
commands (`adapt`/`create`/`publish`) are added in `authoring.py`.
"""

from __future__ import annotations

# Targeted noise suppression: trio (a transitive dep of various ML
# packages users often have globally installed on Python 3.9) prints
# a RuntimeWarning at import time when another package has already
# installed a custom sys.excepthook. The warning has no actionable
# meaning for PromptFlow — it's about how trio would have set up its
# own MultiError tracebacks, which we don't use. Silence it so users
# don't see the same opaque warning on every command. We DELIBERATELY
# target only this one specific warning rather than blanket-ignoring;
# other RuntimeWarnings still pass through.
import warnings
warnings.filterwarnings(
    "ignore",
    message=r".*custom sys\.excepthook handler.*",
    category=RuntimeWarning,
)

import socket
import time
import webbrowser
import sys
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'): _stream.reconfigure(encoding='utf-8', errors='replace')
from typing import List, Optional

import typer
from rich.console import Console
from rich.table import Table

from promptflow_cli import __version__
from promptflow_cli.client import ApiError, AuthRequired, PromptFlowClient
from promptflow_cli.config import (
    load_config,
    resolve_api_key,
    resolve_server,
    write_config_file,
)

app = typer.Typer(
    name="promptflow",
    help="PromptFlow™ programming language for prompting neural networks. Run, create, adapt and share programs.",
    no_args_is_help=True,
    add_completion=False,
)

console = Console()
err = Console(stderr=True)

# Global --server override, stashed by the callback for commands to read.
_state: dict = {"server": None}


@app.callback()
def _main(
    server: Optional[str] = typer.Option(
        None, "--server", help="Backend URL (overrides config and PROMPTFLOW_SERVER)."
    ),
) -> None:
    _state["server"] = server


def _server() -> str:
    return resolve_server(_state["server"])


def _client(require_auth: bool = True) -> PromptFlowClient:
    """Build a client. If require_auth and no key is stored, fail with guidance."""
    key = resolve_api_key()
    if require_auth and not key:
        err.print("Not signed in. Run [bold]promptflow login[/bold] first.")
        raise typer.Exit(code=1)
    return PromptFlowClient(_server(), key)


def _fail(exc: ApiError) -> None:
    """Print an ApiError sensibly and exit non-zero."""
    if isinstance(exc, AuthRequired):
        err.print("[red]✗[/red] Not signed in. Run [bold]promptflow login[/bold].")
    else:
        err.print(f"[red]✗[/red] {exc}")
    raise typer.Exit(code=1)


# ── identity ───────────────────────────────────────────────────────────

@app.command()
def login(
    no_browser: bool = typer.Option(
        False, "--no-browser", help="Print the URL instead of opening a browser."
    ),
) -> None:
    """Sign in by approving this device in your browser.

    Opens the PromptFlow site; you confirm a short code and click Approve.
    If you do not have an account yet, you can sign up on that same page —
    then approve. The resulting API key is stored locally.
    """
    server = _server()
    client = PromptFlowClient(server)
    label = socket.gethostname() or "cli"

    try:
        start = client.device_start(label)
    except ApiError as exc:
        _fail(exc)

    device_code = start["device_code"]
    user_code = start["user_code"]
    verify = start.get("verification_uri_complete") or start["verification_uri"]
    interval = max(int(start.get("interval", 5)), 2)
    deadline = time.monotonic() + min(int(start.get("expires_in", 600)), 600)

    console.print()
    console.print("  Confirm this code in your browser:")
    console.print(f"    [bold yellow]{user_code}[/bold yellow]")
    console.print()

    opened = False
    if not no_browser:
        try:
            opened = webbrowser.open(verify)
        except Exception:
            opened = False
    if opened:
        console.print("  A browser window was opened for you.")
    else:
        console.print("  Open this URL to approve (and sign up / sign in if needed):")
        console.print(f"    [bold]{verify}[/bold]")
    console.print()
    console.print("  [dim]Waiting for approval…[/dim]")

    while True:
        if time.monotonic() > deadline:
            err.print("\n[red]✗[/red] Login timed out. Run [bold]promptflow login[/bold] again.")
            raise typer.Exit(code=1)
        time.sleep(interval)
        try:
            poll = client.device_poll(device_code)
        except ApiError:
            continue  # transient; keep trying until the deadline

        status = poll.get("status")
        if status == "pending":
            continue
        if status == "approved":
            api_key = poll.get("api_key")
            if not api_key:
                err.print("\n[red]✗[/red] Login already completed elsewhere. Try again.")
                raise typer.Exit(code=1)
            cfg = load_config()
            cfg["api_key"] = api_key
            cfg["server"] = server
            write_config_file(cfg)
            console.print("\n[green]✓[/green] Signed in. You're ready to go.")
            console.print("  Try: [bold]promptflow search \"summarize a PDF\"[/bold]")
            return
        if status == "denied":
            err.print("\n[red]✗[/red] Login was denied in the browser.")
            raise typer.Exit(code=1)
        if status in ("expired", "collected"):
            err.print(f"\n[red]✗[/red] Login {status}. Run [bold]promptflow login[/bold] again.")
            raise typer.Exit(code=1)


@app.command()
def logout() -> None:
    """Remove the stored API key from this machine."""
    cfg = load_config()
    if not cfg.get("api_key"):
        console.print("Not signed in.")
        return
    cfg.pop("api_key", None)
    write_config_file(cfg)
    console.print("[green]✓[/green] Signed out on this machine.")
    console.print("  [dim]The key still exists server-side — revoke it in Settings to kill it.[/dim]")


@app.command()
def whoami() -> None:
    """Show the account this CLI is signed in as."""
    client = _client(require_auth=True)
    try:
        data = client.list_api_keys()
    except ApiError as exc:
        _fail(exc)
    keys = data.get("keys") or data.get("api_keys") or []
    console.print(f"  Signed in to [bold]{_server()}[/bold]")
    console.print(f"  Active API keys on this account: [bold]{len(keys)}[/bold]")


# ── discovery ──────────────────────────────────────────────────────────

@app.command()
def search(
    query: List[str] = typer.Argument(..., help="What you're looking for."),
    limit: int = typer.Option(15, "--limit", "-n", help="Max results to show."),
) -> None:
    """Search the process database.

    Searching first is the cheap path: reusing or adapting an existing
    process costs far less than generating one from scratch. Results are
    ranked by the backend's agentic retrieval.
    """
    q = " ".join(query).strip()
    if not q:
        err.print("Nothing to search for.")
        raise typer.Exit(code=1)

    client = _client(require_auth=True)
    try:
        data = client.search(q)
    except ApiError as exc:
        _fail(exc)

    result = data.get("result") or {}
    # The backend's search result shape carries a shortlist; be tolerant of
    # the exact key since it's a debug-mode payload.
    hits = (
        result.get("shortlist")
        or result.get("results")
        or result.get("candidates")
        or []
    )
    if not hits:
        console.print(f'No processes matched "[bold]{q}[/bold]".')
        console.print("  [dim]Nothing close enough to reuse — `promptflow create` will build it fresh.[/dim]")
        return

    table = Table(title=f'Matches for "{q}"', show_lines=False)
    table.add_column("Process", style="bold")
    table.add_column("ID", style="dim")
    table.add_column("Score", justify="right")

    for hit in hits[:limit]:
        name = hit.get("name") or hit.get("label") or hit.get("title") or "—"
        pid = str(hit.get("process_id") or hit.get("id") or "—")
        score = hit.get("score")
        score_s = f"{score:.2f}" if isinstance(score, (int, float)) else "—"
        table.add_row(str(name), pid[:24], score_s)

    console.print(table)
    console.print(
        "  [dim]Reuse one with[/dim] [bold]promptflow adapt <id> \"<change>\"[/bold]"
        "[dim], or build new with[/dim] [bold]promptflow create[/bold][dim].[/dim]"
    )


@app.command()
def version() -> None:
    """Print the CLI version."""
    console.print(f"promptflow-cli [bold]{__version__}[/bold]")


# Register the contribution-side commands (adapt / create / publish).
from promptflow_cli import authoring as _authoring  # noqa: E402

_authoring.register(app, console, err, _client, _fail, _server)

# Register the bundle command (publish a folder of work as a process).
from promptflow_cli import bundle as _bundle  # noqa: E402

_bundle.register(app, console, err, _client, _fail)

# Register the local (BYOK) commands: keys + run-local.
from promptflow_cli import local as _local  # noqa: E402

_local.register(app, console, err)


if __name__ == "__main__":
    app()
