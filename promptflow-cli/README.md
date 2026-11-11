# PromptFlow™ CLI and interpreter 0.3.1

PromptFlow™ is a programming language for prompting neural networks. This
download contains the CLI, interpreter and `examples/text-summary.promptflow`.
Version 0.3.1 adds source-image editing and packaged reference images, including
the Marketplace 180° panorama workflow. A workflow unlock and provider usage
are separate: local runs use your own provider keys.

Download `promptflow-cli.zip`, extract it, and open a terminal in the extracted
`promptflow-cli` folder. Requires Python 3.9+. There is currently no
`promptflow-interpreter` or `promptflow-sdk` package to install from PyPI.

## Install from the download

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install .
.venv\Scripts\promptflow --help
```

macOS / Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/promptflow --help
```

Keep using the full executable path, or activate the environment:
`.venv\Scripts\Activate.ps1` on Windows; `source .venv/bin/activate` on macOS/Linux.
If PowerShell blocks activation, use the executable path directly.
`python -m promptflow_cli` is also available in this environment.
Installation needs internet access for ordinary Python dependencies; it installs
this downloaded source folder, not a PromptFlow package from PyPI.

## Run a downloaded process

```sh
promptflow run "my-process.promptflow" --text "your input" --check
promptflow run "my-process.promptflow" --text "your input"
```

`--check` checks the bundle, inputs, keys, and runtime dependencies without making
provider calls. It does not prove a credential is valid or a model is available.

| Step | Required environment variable / dependency |
| --- | --- |
| AI text or image analysis | `ANTHROPIC_API_KEY` |
| Brave web, news, or image search | `BRAVE_API_KEY` |
| fal media | `FAL_KEY`; `python -m pip install fal-client` |
| OpenAI image | `OPENAI_API_KEY` |
| Custom recipe secrets | Variables listed in `manifest.json` |

Set variables with `$env:ANTHROPIC_API_KEY = "your-key"` in PowerShell or
`export ANTHROPIC_API_KEY="your-key"` in bash. Never put keys in shared bundles.
Existing `promptflow keys` values also work; environment variables take priority.
Stored keys are local files, not an encrypted vault.

Local runs do not require PromptFlow login or use PromptFlow tokens. They call
your provider accounts directly and may incur provider charges. Inspect custom
recipes and requirements before running another author's code.

```sh
promptflow run "my-process.promptflow" --input text=@input.txt
promptflow run "my-process.promptflow" --input image=./photo.png --text "Describe this"
promptflow run "my-process.promptflow" --text "your input" --output-dir ./results
promptflow run "my-process.promptflow" --text "your input" --model claude-sonnet-5-5
```

Use `--model` or `PROMPTFLOW_TEXT_MODEL` to select a compatible Anthropic model.
Activity describes the current work: searching sources, analyzing inputs, running
a tool, or assembling a document. Long-running steps report elapsed time.
JSON results go to stdout and a new file in `promptflow-output/`; progress goes to
stderr. The runner does not print key values or private model deliberation.

Ctrl+C stops the local runner. Submitted provider jobs may still complete and be
billed. The CLI limits runs to ten minutes and does not automatically replay
failed paid steps. Inspect failures before retrying.

## Named runs and input preparation

Use `--text` for input data and `--instructions` for work the interpreter should
do before running the saved workflow. For example:

```sh
promptflow run "search-policy.promptflow" --name "Synthetic Product Labels" --instructions "Generate five clearly labeled synthetic product records first, then run the workflow" --model claude-sonnet-5-5 --max-output-tokens 4096
```

The interpreter first makes one AI call to plan the preparation. It shows the run
name and tools, saves a reviewable preparation-plan JSON file, and asks before
performing those steps. `--yes` accepts this plan for scripts. Cancelling still
incurs the initial planning call's provider cost. Prepared inputs are validated
before being passed into the unchanged saved workflow. `--check` never calls a
provider and cannot validate inputs that have not been generated yet.

Preparation can use AI text, Brave search, OpenAI image generation, and media
tools already declared in the bundle, when their provider keys are available.
An unavailable tool or missing essential detail produces an error. The local
preparation planner is limited to 12 steps; it cannot invent arbitrary tools.

For a hosted run, use the server process ID:

```sh
promptflow run PROCESS_ID --name "Synthetic Product Labels" --instructions "Generate five synthetic examples first, then run" --model claude-haiku-5-5 --max-run-tokens 500
```

Hosted runs use the account's saved **Model & API access** settings. `--model`
overrides all AI text steps for this run. `--max-run-tokens` caps the hosted
compute-credit charge, including prepared inputs and resolved nested steps.
Creator royalties and external provider costs are separate. This flag does not
apply to local runs, which bill provider accounts directly. Use `--model` and
`--max-output-tokens` to constrain local text-model costs; images, search, media,
and repeated calls still incur their own provider charges.

In the web app, **Model & API access → Economy** selects lower-cost text models,
8,192 planning output tokens, 2,048 output tokens per AI step, and at most five
items per loop. Customize these limits for larger jobs. A loop that exceeds its
limit fails before processing any of its items; it does not silently drop data.
The downloaded runner respects a loop's saved `max_iterations` (up to 50).
Changing web settings does not retroactively change an already downloaded file.

## Direct Python and editable bundles

New exports include their runtime:

```sh
python "my-process.promptflow" --text "your input"
```

To edit prompts or install author-declared dependencies:

```sh
python -m zipfile -e "my-process.promptflow" ./my-process
python -m pip install -r ./my-process/requirements.txt
promptflow run ./my-process --text "your input"
```

The manifest step graph is executable; prompts live in `prompts/`.
`original.py` is a reference copy. Supported steps include AI text/JSON, built-in
search and image recipes, fal media, document assembly, loops, nested processes,
and bundled Python recipes with `run(params, scope)`. Missing implementations
fail with an error, never false success. Nested processes must be accessible at
export time. Loops are limited to 50 items; nesting to six levels.

Older web downloads with a `promptflow/1` manifest containing `steps` work through
the new CLI. Exports missing a step graph must be downloaded again. The unrelated
YAML interpreter and continuation-lab formats are not the web export format.

## Online account features

```sh
promptflow login
promptflow whoami
promptflow search "summarize research papers"
promptflow create "Create a process that summarizes research papers"
promptflow export PROCESS_ID --out ./my-process
promptflow run PROCESS_ID --input text="your input"
```

Login opens browser approval. Online runs use platform billing and show the quote
before execution, including for your own processes. Creating and editing show
public activity updates while the server works. Interrupted generation does not
silently retry; check Processes for a saved draft first.

Use `promptflow COMMAND --help` for options. Configure the server with `--server`
or `PROMPTFLOW_SERVER`, and authentication with login or `PROMPTFLOW_API_KEY`.

## Verification

Tests use controlled provider responses and make no paid provider calls. Release
testing installs the ZIP in a clean environment and runs exports from the web
bundle builder. Provider availability, model access, and custom dependencies
still determine live execution.
