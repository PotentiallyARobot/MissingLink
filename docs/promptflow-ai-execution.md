# Model settings and live execution — 0.5.0

## Automatic Chat mode

The composer has Interpreter and Chat buttons. Chat is automatic: it matches a
request to an available saved/public workflow, or designs a temporary private
workflow, runs it, and reviews the actual output. A failed quality check permits
one revised draft and retest. Passing drafts enter the user's private library;
failed or stopped drafts remain hidden and disabled. Nothing is auto-published.
Agent verification is separate from the author's human validation for publishing.

Questions and requests for ideas receive answers without creating workflows.
Essential missing inputs produce a focused question. Explicitly requested sample
inputs can be generated as part of preparation. Follow-ups include recent chat
history and the selected workflow. Workflow steps, output checks, public reasoning
summaries, tool actions and artifacts are visible in the conversation.

Chat auto task credit limit defaults to 5,000 and applies cumulatively to the
workflow run estimates across both attempts. The account's per-run cap and balance
remain enforced. Planning and review follow the existing hosted model billing
policy; the limit does not represent provider input/output token usage. Task IDs
are idempotent, and connection recovery only reads the existing task. Stop prevents
subsequent agent actions; already dispatched provider work can still finish.
Tasks have a 20-minute deadline and never register cron jobs or autonomous agents.

The agent's checks inspect the completed step outputs and generated images when
applicable. They are an AI review, not a guarantee of correctness or a claim that
generated applications were exercised in a real browser. Unverified essential
requirements must fail the review. The transcript records the checks and limitations.

Live validation (2026-11-17): an ideas-only request returned an answer without
creating or running a workflow. Chat then created Meeting Commitment Ledger with
two text steps, ran it against supplied meeting notes, independently checked the
actual ledger, and saved it privately (390 compute credits). A second request in
Chrome reused that saved workflow with different notes and passed verification
(1,353 credits under the account's larger output allowance). Both outputs retained
verbatim evidence and flagged the unassigned action's missing owner and date.
The saved workflow is committed, unpublished, and not publicly runnable. Repeating
the creation task ID returned HTTP 409; status recovery returned the saved result
without another run. The live test caught and fixed an authoring request being
misrouted into input preparation.

Chat uses a narrow conversation column, subdued background, right-aligned user
messages, rendered prose/tables, and compact expandable activity with action icons.
The composer stays aligned with the conversation. Detailed checks and public
reasoning summaries remain available without surrounding every reply in panels.
Text is rendered with DOM nodes; generated HTML is not executed by the chat renderer.

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
