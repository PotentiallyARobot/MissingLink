"""PromptFlow CLI — discover, adapt, create, and publish reusable AI processes."""

# Suppress trio's import-time RuntimeWarning about sys.excepthook.
#
# Why this lives HERE in __init__.py rather than in app.py: trio emits
# this warning at trio's own import time. When the CLI imports httpx
# (which may transitively load anyio + trio), the warning fires
# *during* that import chain — before any code inside app.py runs. To
# catch a warning that fires during a chain of imports, the filter
# must be installed before the chain begins. The package __init__ is
# the earliest reliable hook: it executes the moment `from
# promptflow_cli import ...` happens, before any of the modules under
# the package start importing third-party deps.
#
# Targeted by message text so other RuntimeWarnings still surface.
import warnings as _warnings
_warnings.filterwarnings(
    "ignore",
    message=r".*custom sys\.excepthook handler.*",
    category=RuntimeWarning,
)

__version__ = "0.3.1"
