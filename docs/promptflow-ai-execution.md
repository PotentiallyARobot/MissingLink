# Model settings and live execution — 0.5.0

Workflow creation defaults to GPT-6 Astra when OpenAI is configured. Existing
explicit account choices remain respected. GPT-6.1 Sol is the general-purpose
OpenAI step model; Luna can handle extraction. Model selection and output budgets
remain separate, and saved steps retain their model unless the user enables the
override in Model & API access.

Text steps retain the historical `type: "claude"` name for archive compatibility.
They can use either provider. Example:

```json
{
  "id": "verify_sources",
  "name": "Verify product specifications",
  "type": "claude",
  "text_model": "gpt-6.1-sol",
  "reasoning_effort": "high",
  "max_tokens": 8192,
  "verbosity": "medium",
  "web_search": {
    "enabled": true,
    "max_calls": 3,
    "context_size": "high",
    "allowed_domains": ["example.com"]
  },
  "system_prompt": "Verify claims against primary sources. Include source links and identify unresolved claims.",
  "user_prompt": "Check this brief: {{user_text}}",
  "output_format": "text"
}
```

- Reasoning effort: `auto`, `low`, `medium`, `high`, `xhigh`, `max`.
- Output allowance includes reasoning and visible output; maximum 128,000 tokens
  for the listed models. The account's step allowance is enforced before quoting.
- OpenAI verbosity: `low`, `medium`, `high`. Claude ignores this OpenAI-specific field.
- Web research is optional per step. OpenAI's built-in tool can search, read pages,
  and find passages. Call allowance is 1–10 and cannot exceed the account setting.
  Disabling account web research disables it on quoted text steps and in planning/chat.
- Independent steps can share a contiguous `parallel_group`. Existing dependency
  checks and a maximum of three concurrent steps still apply.

The UI streams response drafts, provider-generated reasoning summaries, tool
activity, and clickable source links. These are public provider summaries, not
private reasoning traces. Raw thinking, encrypted reasoning, request headers and
credentials are excluded from the activity protocol. Draft previews are bounded
and updates are batched to keep the interface responsive. Final outputs are
rendered separately. Activity is currently a live view; reloading a chat does not
replay the transient event history.

The same settings travel in `.promptflow` archives. CLI 0.5.0 streams public
summaries and actions to stderr while keeping final output files intact. Reinstall
from the updated CLI ZIP; existing extracted archives contain their old embedded
runtime and should be downloaded again to use these capabilities.

Run estimates now include the selected text model, output allowance, estimated
input size, and a web-search allowance. Search content input is estimated at 8,000
tokens per allowed call. This is an estimate, not measured provider usage. Existing
confirmed quotes are checked before execution when pricing changes.

Tools remain declared and bounded: this change enables read-only provider web
research and exposes the existing registered generation/assembly recipes. It does
not grant generated code shell access or permission to perform arbitrary external
writes. Private output access controls remain in force.

Validation (2026-11-15): Astra generated an API migration brief workflow with two
parallel Sol research steps and an Astra synthesis step. The creation response
used 4,715 input and 4,831 output tokens; its first public summary arrived in 19.5s.
The generated workflow then completed in the local interpreter in 240s, producing
source-linked research and a migration checklist. Regression checks cover public
event filtering, reasoning settings, search allowances, quoting, interrupted
streams, archive execution, and the existing marketplace workflows.

Production UI validation: Astra created Source Check Brief with a Sol research
step and an Astra synthesis step. The hosted run completed, streamed page-reading
actions, source links and a public reasoning summary, and displayed the final
brief with its evidence gaps. The confirmed charge was 1,418 platform tokens.
The deployed CLI ZIP installed successfully as version 0.5.0.

Provider contracts: [reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning),
[web search](https://developers.openai.com/api/docs/guides/tools-web-search),
[Responses streaming](https://developers.openai.com/api/reference/resources/responses/streaming-events).
