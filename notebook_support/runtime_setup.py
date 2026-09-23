"""Embedded in notebook setup cells so downloads do not depend on a second repo."""
import os
import sys
import re
import subprocess
import tempfile
from pathlib import Path
from getpass import getpass


def ml_token():
    token = os.environ.get("MISSING_LINK_TOKEN", "").strip()
    if not token or "*" in token:
        try:
            from google.colab import userdata
            token = userdata.get("MISSING_LINK_TOKEN").strip()
        except Exception:
            token = getpass("MissingLink API key (hidden; or enable MISSING_LINK_TOKEN in Colab Secrets): ").strip()
    if not token or "*" in token:
        raise RuntimeError("Add your MissingLink API key in Colab Secrets and enable notebook access, then rerun setup.")
    os.environ["MISSING_LINK_TOKEN"] = token
    return token


def ml_redact(text):
    token = os.environ.get("MISSING_LINK_TOKEN", "")
    if token:
        text = text.replace(token, "[redacted]")
    return re.sub(r"https://[^/\s]+@", "https://[redacted]@", text)


def ml_run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode:
        print(ml_redact(result.stdout or "")[-4000:])
        raise RuntimeError("Setup command failed. Fix the error above and rerun this cell; do not continue to model loading.")


def ml_preflight():
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("These prebuilt wheels require Python 3.12. Select a compatible Colab runtime before installing.")
    try:
        gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("GPU unavailable. Choose Runtime > Change runtime type > GPU, reconnect, and rerun setup.") from None
    if gpu.returncode or not gpu.stdout.strip():
        raise RuntimeError("GPU unavailable. Choose Runtime > Change runtime type > GPU, reconnect, and rerun setup.")
    print("Detected GPU / VRAM (MiB):", gpu.stdout.strip())
    return gpu.stdout.strip()


def ml_download(path, destination):
    import requests
    # Requests strips Authorization on cross-host redirects. Keys never enter pip URLs.
    try:
        with requests.get("https://missinglink.build/" + path.lstrip("/"),
                          headers={"Authorization": "Bearer " + ml_token()}, stream=True,
                          timeout=(20, 180)) as response:
            if response.status_code in (401, 402, 403):
                raise RuntimeError("MissingLink denied access. Check your API key and subscription/entitlement, then rerun setup.")
            response.raise_for_status()
            with open(destination, "wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
    except requests.RequestException:
        raise RuntimeError("Download failed. Check the connection and rerun setup; model loading has not started.") from None


def ml_install_wheel(filename):
    print("Downloading", filename)
    with tempfile.TemporaryDirectory(prefix="missinglink-") as folder:
        wheel = Path(folder) / filename
        ml_download("wheel/" + filename, wheel)
        ml_run([sys.executable, "-m", "pip", "install", "--no-deps", str(wheel)])


def ml_install_tier(machine):
    if machine not in ("a100", "l4", "t4", "blackwell"):
        raise ValueError("Choose a100, l4, t4, or blackwell for MACHINE.")
    with tempfile.TemporaryDirectory(prefix="missinglink-") as folder:
        requirements = Path(folder) / "requirements.txt"
        ml_download(machine + ".txt", requirements)
        # This server-generated file contains authenticated wheel URLs. Delete after use,
        # and redact pip diagnostics before displaying them.
        ml_run([sys.executable, "-m", "pip", "install", "--no-deps", "-r", str(requirements)])


def ml_clone(url, destination):
    destination = Path(destination)
    if (destination / ".git").is_dir():
        print("Reusing checkout:", destination, "(local changes preserved)")
        return
    if destination.exists():
        raise RuntimeError(f"{destination} exists but is not a Git checkout. Choose a new directory; existing files were preserved.")
    ml_run(["git", "clone", "--recursive", url, str(destination)])
