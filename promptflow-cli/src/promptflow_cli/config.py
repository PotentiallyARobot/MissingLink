"""CLI configuration: where the API key and server URL live on disk.

The config is a single JSON file at ~/.promptflow/config.json:

    {
      "server":  "https://www.missinglink.build",
      "api_key": "pf_live_..."
    }

`server` can be overridden per-invocation with the PROMPTFLOW_SERVER env var
or the global --server flag; `api_key` with PROMPTFLOW_API_KEY. This lets the
same install talk to staging vs production without rewriting the file.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any, Dict

# The deployed backend. Override with --server or PROMPTFLOW_SERVER until the
# final domain is settled.
DEFAULT_SERVER = "https://www.missinglink.build"


def config_dir() -> Path:
    return Path(os.environ.get("PROMPTFLOW_HOME") or (Path.home() / ".promptflow"))


def config_path() -> Path:
    return config_dir() / "config.json"


def load_config() -> Dict[str, Any]:
    """Read the config file. Returns {} if it does not exist or is unreadable."""
    path = config_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8")) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def write_config_file(cfg: Dict[str, Any]) -> None:
    """Persist the config file, creating the directory and locking permissions.

    The file holds a credential, so it is written 0600 (owner read/write only).
    """
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = config_path()
    path.write_text(json.dumps(cfg, indent=2) + "\n", "utf-8")
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        # Best-effort — some filesystems (e.g. Windows) ignore chmod.
        pass


def resolve_server(cli_override: str | None = None) -> str:
    """Server URL precedence: --server flag > env var > config file > default."""
    if cli_override:
        return cli_override.rstrip("/")
    env = os.environ.get("PROMPTFLOW_SERVER")
    if env:
        return env.rstrip("/")
    cfg = load_config()
    return str(cfg.get("server") or DEFAULT_SERVER).rstrip("/")


def resolve_api_key() -> str | None:
    """API key precedence: env var > config file. None if unset."""
    env = os.environ.get("PROMPTFLOW_API_KEY")
    if env:
        return env.strip()
    cfg = load_config()
    key = cfg.get("api_key")
    return str(key).strip() if key else None
