"""Local, bring-your-own-key execution.

A process download includes a manifest and a portable runtime. This module
runs its step graph locally using environment variables or stored provider
keys. Progress streams immediately; provider usage is billed to those keys.

Two commands:
  - `promptflow keys`       — store/show BYOK API keys (~/.promptflow/keys.json)
  - `promptflow run-local`  — run a bundle or extracted folder with those keys
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Dict

import typer

from promptflow_cli.config import config_dir


# The BYOK keys file. Separate from config.json so the platform API key and
# the provider keys are not tangled together. 0600 — it holds secrets.
_KEYS_FILE = "keys.json"

# Maps a friendly name to the env var the generated process.py expects.
_KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "brave": "BRAVE_API_KEY",
    "fal": "FAL_KEY",
    "openai": "OPENAI_API_KEY",
    "elevenlabs": "ELEVEN_LABS_API_KEY",
}


def _keys_path() -> Path:
    return config_dir() / _KEYS_FILE


def _load_keys() -> Dict[str, str]:
    p = _keys_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text("utf-8")) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_keys(keys: Dict[str, str]) -> None:
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = _keys_path()
    p.write_text(json.dumps(keys, indent=2) + "\n", "utf-8")
    try:
        p.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        pass  # Windows / some filesystems ignore chmod


def register(app: typer.Typer, console, err) -> None:
    """Wire the keys + run-local commands onto the main Typer app."""

    @app.command()
    def keys(
        set_key: str = typer.Option(
            None, "--set", help="Store a key as name=value "
            "(name: anthropic, brave, fal, openai, elevenlabs)."
        ),
        clear: str = typer.Option(
            None, "--clear", help="Remove a stored key by name."
        ),
    ) -> None:
        """Manage your own API keys for local (BYOK) process execution.

        Keys are stored at ~/.promptflow/keys.json (owner-only) and used by
        `run-local`. With no options, shows which keys are set.

            promptflow keys --set anthropic=sk-ant-...
            promptflow keys --set brave=BSA...
            promptflow keys                       # show what's stored
        """
        keys_store = _load_keys()

        if set_key:
            if "=" not in set_key:
                err.print("[red]✗[/red] Use --set name=value (e.g. --set brave=BSA...).")
                raise typer.Exit(code=1)
            name, value = set_key.split("=", 1)
            name = name.strip().lower()
            value = value.strip()
            if name not in _KEY_ENV:
                err.print(
                    f"[red]✗[/red] Unknown key '{name}'. "
                    f"Known: {', '.join(sorted(_KEY_ENV))}."
                )
                raise typer.Exit(code=1)
            if not value:
                err.print("[red]✗[/red] Empty value.")
                raise typer.Exit(code=1)
            keys_store[name] = value
            _save_keys(keys_store)
            console.print(f"  [green]\u2713[/green] Stored [bold]{name}[/bold] key.")
            return

        if clear:
            name = clear.strip().lower()
            if name in keys_store:
                del keys_store[name]
                _save_keys(keys_store)
                console.print(f"  [green]\u2713[/green] Cleared [bold]{name}[/bold] key.")
            else:
                console.print(f"  [dim]No '{name}' key was stored.[/dim]")
            return

        # No options — show status.
        console.print()
        console.print("  [bold]BYOK keys[/bold]   [dim](~/.promptflow/keys.json)[/dim]")
        for name, env_var in sorted(_KEY_ENV.items()):
            mark = "[green]set[/green]" if keys_store.get(name) else "[dim]not set[/dim]"
            console.print(f"    {name:12s} {mark}   [dim]\u2192 {env_var}[/dim]")
        console.print()
        console.print("  [dim]Set one with:  promptflow keys --set anthropic=sk-ant-...[/dim]")

    @app.command(name="run-local")
    def run_local(
        process_file: str = typer.Argument(
            ..., help="Path to a downloaded .promptflow bundle or extracted bundle folder."
        ),
        text: str = typer.Option(
            None, "--text", "-t", help="The text input for the process."
        ),
        dry_run: bool = typer.Option(
            False, "--dry-run", help="Show what would run without executing."
        ),
    ) -> None:
        """Run a downloaded .promptflow or extracted bundle with live progress.

        Uses your provider keys. Provider charges may apply.
        """
        raise typer.Exit(execute_bundle(process_file, [], text, dry_run))


def execute_bundle(process_file, inputs=None, text=None, check=False, output_dir="promptflow-output", model=None, instructions=None, name=None, yes=False, max_output_tokens=4096, override_step_limits=False):
    """Use a child process so Ctrl+C, output streams, and working paths behave normally."""
    from promptflow_cli import runtime
    p = Path(process_file).expanduser().resolve()
    if not p.exists():
        print("File not found: " + str(p), file=sys.stderr)
        return 1
    env = dict(os.environ)
    for name,value in _load_keys().items():
        if name in _KEY_ENV and value: env.setdefault(_KEY_ENV[name],value)
    cmd = [sys.executable,"-u",str(Path(runtime.__file__).resolve()),str(p),"--output-dir",output_dir]
    for item in inputs or []: cmd.extend(["--input",item])
    if text is not None: cmd.extend(["--text",text])
    if check: cmd.append("--check")
    if model: cmd.extend(["--model",model])
    if instructions: cmd.extend(["--instructions",instructions])
    if name: cmd.extend(["--name",name])
    if yes: cmd.append("--yes")
    cmd.extend(["--max-output-tokens",str(max_output_tokens)])
    if override_step_limits: cmd.append('--override-step-limits')
    try:
        # Inherit stdout/stderr: live progress must not be buffered until completion.
        return subprocess.run(cmd,env=env,timeout=max(600,min(7200,max_output_tokens//20))).returncode
    except subprocess.TimeoutExpired:
        print("Run reached its time limit. A submitted provider job may still complete.",file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
