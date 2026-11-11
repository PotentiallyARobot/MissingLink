"""The `bundle` command — publish a folder of work as a process.

`promptflow bundle ./mydir` zips a local folder (code, requirements.txt,
assets), uploads it to the backend's contribution endpoint, and triggers
extraction — the backend distills the bundle into a process you can then
commit and publish.

Why a zip and not individual files: the backend's /upload/contribute takes
exactly one zip (plus an optional chat transcript). The CLI builds that zip
client-side with the stdlib — no extra dependencies.

A deliberate safety rule: this command will NOT upload files that look like
they contain credentials (.env, credentials.*, *.pem, id_rsa, etc.). API
keys belong in the encrypted secrets store (`me/secrets`), referenced by
name — never bundled into an artifact other people can download.
"""

from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path
from typing import Callable, List

import typer

from promptflow_cli.client import ApiError, PromptFlowClient

_console = None
_err = None
_client_factory: Callable[..., PromptFlowClient] = None  # type: ignore
_fail: Callable[[ApiError], None] = None  # type: ignore

# Files we refuse to upload — they tend to hold secrets. Matched on the
# lowercased filename. A bundle is downloadable by others; a key in it leaks.
_SECRET_NAMES = {
    ".env", ".env.local", ".env.production", "credentials", "credentials.json",
    "secrets.json", "id_rsa", "id_ed25519", ".npmrc", ".pypirc",
}
_SECRET_SUFFIXES = (".pem", ".key", ".pfx", ".p12")

# Directories never worth uploading — noise, and they blow the size limit.
_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache",
    ".pytest_cache", "dist", "build", ".idea", ".vscode", ".DS_Store",
}

_POLL_INTERVAL_S = 3
_EXTRACT_TIMEOUT_S = 300


def register(app: typer.Typer, console, err, client_factory, fail) -> None:
    """Wire the bundle command onto the main Typer app."""
    global _console, _err, _client_factory, _fail
    _console, _err = console, err
    _client_factory, _fail = client_factory, fail
    app.command()(bundle)


def _looks_like_secret(name: str) -> bool:
    low = name.lower()
    if low in _SECRET_NAMES:
        return True
    return any(low.endswith(suf) for suf in _SECRET_SUFFIXES)


def _collect_files(root: Path) -> tuple[list[Path], list[str]]:
    """Walk the folder. Returns (files_to_include, skipped_secret_names)."""
    included: List[Path] = []
    skipped_secrets: List[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        # Skip anything inside a noise directory.
        if any(part in _SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        if _looks_like_secret(path.name):
            skipped_secrets.append(str(path.relative_to(root)))
            continue
        included.append(path)
    return included, skipped_secrets


def _build_zip(root: Path, files: List[Path]) -> bytes:
    """Zip the given files, paths relative to root, in memory."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=str(f.relative_to(root)))
    return buf.getvalue()


def bundle(
    folder: str = typer.Argument(..., help="Folder to publish as a process."),
    title: str = typer.Option(
        "", "--title", "-t", help="A title for the bundle (defaults to folder name)."
    ),
    chat: str = typer.Option(
        "", "--chat", help="Optional chat transcript file for richer extraction."
    ),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip the pre-upload confirmation."
    ),
) -> None:
    """Publish a folder of work as a process.

    Zips the folder (code, requirements.txt, assets), uploads it, and lets
    the backend distill it into a process. Files that look like they hold
    credentials are skipped — keep API keys in `promptflow` secrets, not in
    a shared bundle.
    """
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        _err.print(f"[red]✗[/red] Not a folder: {folder}")
        raise typer.Exit(code=1)

    bundle_title = title.strip() or root.name

    # ── collect + safety-screen ─────────────────────────────────────────
    files, skipped_secrets = _collect_files(root)
    if not files:
        _err.print(f"[red]✗[/red] No files to upload in {folder} (after skipping noise).")
        raise typer.Exit(code=1)

    if skipped_secrets:
        _console.print(
            f"  [yellow]Skipped {len(skipped_secrets)} file(s) that look like "
            f"credentials[/yellow] — these never go in a shared bundle:"
        )
        for s in skipped_secrets[:8]:
            _console.print(f"    [dim]· {s}[/dim]")
        _console.print(
            "  [dim]If a process needs an API key, store it with the secrets "
            "feature and reference it by name.[/dim]"
        )

    # ── enforce backend limits client-side (fail fast, clear message) ───
    client = _client_factory(require_auth=True)
    if len(files) > client.UPLOAD_MAX_FILES:
        _err.print(
            f"[red]✗[/red] {len(files)} files — the limit is "
            f"{client.UPLOAD_MAX_FILES}. Trim the folder and retry."
        )
        raise typer.Exit(code=1)
    oversized = [f for f in files if f.stat().st_size > client.UPLOAD_MAX_SINGLE_FILE_BYTES]
    if oversized:
        _err.print(
            f"[red]✗[/red] {oversized[0].relative_to(root)} exceeds the "
            f"{client.UPLOAD_MAX_SINGLE_FILE_BYTES // (1024*1024)} MB per-file limit."
        )
        raise typer.Exit(code=1)

    zip_bytes = _build_zip(root, files)
    if len(zip_bytes) > client.UPLOAD_MAX_BYTES:
        _err.print(
            f"[red]✗[/red] Zipped bundle is "
            f"{len(zip_bytes) // (1024*1024)} MB — the limit is "
            f"{client.UPLOAD_MAX_BYTES // (1024*1024)} MB. Remove large assets."
        )
        raise typer.Exit(code=1)

    chat_bytes = None
    if chat:
        chat_path = Path(chat).expanduser()
        if not chat_path.is_file():
            _err.print(f"[red]✗[/red] Chat file not found: {chat}")
            raise typer.Exit(code=1)
        chat_bytes = chat_path.read_bytes()

    # ── confirm ─────────────────────────────────────────────────────────
    _console.print()
    _console.print(f'  Bundle: [bold]{bundle_title}[/bold]')
    _console.print(f"    {len(files)} files, {len(zip_bytes) // 1024} KB zipped")
    if chat_bytes is not None:
        _console.print(f"    + chat transcript ({len(chat_bytes) // 1024} KB)")
    if not yes:
        if not typer.confirm("  Upload this bundle?", default=True):
            _console.print("  Cancelled.")
            raise typer.Exit(code=0)

    # ── upload ──────────────────────────────────────────────────────────
    _console.print("  Uploading…")
    try:
        up = client.upload_contribute(zip_bytes, bundle_title, chat_bytes)
    except ApiError as exc:
        _fail(exc)

    upload_id = up.get("upload_id")
    if not upload_id:
        _err.print("[red]✗[/red] Upload succeeded but no upload id was returned.")
        raise typer.Exit(code=1)
    _console.print(
        f"  [green]✓[/green] Uploaded {up.get('file_count', len(files))} files."
    )

    # ── extract ─────────────────────────────────────────────────────────
    _console.print("  Distilling the bundle into a process…")
    try:
        client.upload_extract(upload_id)
    except ApiError as exc:
        _fail(exc)

    # Poll for completion.
    deadline = time.monotonic() + _EXTRACT_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(_POLL_INTERVAL_S)
        try:
            st = client.upload_status(upload_id)
        except ApiError:
            continue
        upload = st.get("upload") or {}
        status = str(upload.get("status") or "")
        if status == "extracted":
            proc_id = upload.get("resulting_process_id")
            _console.print("  [green]✓[/green] Process created from your bundle.")
            if proc_id:
                _console.print(f"  Process id: [bold]{proc_id}[/bold]")
                _console.print()
                _console.print("  Next:")
                _console.print(f'    [bold]promptflow publish --process {proc_id}[/bold]')
            return
        if status == "failed":
            _err.print(
                f"[red]✗[/red] Extraction failed: "
                f"{upload.get('error_message') or 'unknown error'}"
            )
            raise typer.Exit(code=1)
        if status in ("expired",):
            _err.print("[red]✗[/red] The upload expired before extraction finished.")
            raise typer.Exit(code=1)
        _console.print(f"  [dim]…{status or 'working'}[/dim]")

    _err.print("[red]✗[/red] Extraction timed out. Check the bundle in the web app.")
    raise typer.Exit(code=1)
