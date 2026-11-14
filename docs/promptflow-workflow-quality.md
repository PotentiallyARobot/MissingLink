# Marketplace quality review — 14 November 2026

Catalog release 1.3, revision 4; downloadable interpreter 0.4.2.

The release checks the delivered files, not just whether the provider returned a response. All twelve workflows completed real-provider execution. Ten ran from exported `.promptflow` archives through an installed local CLI using OpenAI text/image APIs. Research Brief and Visual Lesson Pack ran on the hosted service with real Brave Search, OpenAI text, and (for the lesson) image generation. All twelve exported bundles also pass Python execution with controlled provider responses. The local machine has no Brave key, so the two search workflows were not represented as fully live local tests.

## Changes that affect the work

- Five file-producing workflows now export the final reviewed data. Previously, some CSV/JSON/channel files came from earlier drafts even when the displayed summary had been corrected.
- Required JSON fields, source excerpts and feedback counts are checked before downstream execution. These checks catch malformed data and invented quotations; they do not prove semantic truth or independent verification.
- Research uses two search angles and targets identifiable primary sources. Its final ledger preserves exact excerpts and URLs, and its brief distinguishes search snippets from full articles. The revised bookstore test includes Google's own documentation.
- Meeting actions distinguish proposals from commitments and preserve unknown dates. Feedback counts distinct supplied entries rather than inventing customer totals. Proposal criteria are observable and match scope. Campaign copy preserves supplied facts and keeps internal publishing questions out of customer-facing drafts.
- Image review steps actually receive the generated image, with the original where needed. The local interpreter previously ignored explicitly declared review images. Hosted loop/resumed paths now use the same image assembly as ordinary steps.
- The instruction-card workflow generates, inspects, corrects once, then compares the original and corrected card. It reports remaining defects; a completed execution is not an automatic visual approval.
- Website and game source receives a separate code review before packaging. Artwork and source generation remain parallel. The game is accurately described as adapting a collect-and-dodge engine.
- Reports use readable headings, evidence links, tables, restrained typography and print styles. Raw JSON is available in expandable source sections. File downloads include a standalone `report.html` alongside editable CSV/JSON/Markdown. Local image reports embed their images for offline portability.

## Real output review

| Workflow | Observed result | Assessment / limit |
|---|---|---|
| Research Brief | Decision brief, comparison, primary-source evidence, exact excerpt ledger, raw search evidence | Useful decision support. Full-page retrieval and independent fact verification are still absent. |
| Meeting Action Plan | Actions CSV and matching recap; Maya committed, Leon proposed, no invented deadline | Passed the supplied commitment/ambiguity checks. |
| Feedback Compass | Import and export themes each supported by two distinct entries, exact excerpts, evidence-linked backlog | Passed counts and traceability checks. Does not generalize a five-entry sample to a population. |
| Launch Campaign Kit | Consistent product facts, separate landing/email/three social posts, relative-day rollout | Fixed an array/string export failure and removed repeated approval boilerplate. No invented price, date or environmental claims. |
| Client Proposal Builder | Five-page bakery scope, six-week proposed sequence, matching acceptance CSV, online ordering excluded | Reduced a roughly 1,200-word overqualified draft to a focused proposal. Budget remains unresolved. |
| Visual Lesson Pack | Sourced water-cycle lesson, worked example, three reasoning questions, answer key, actual diagram review | Review found the diagram usable; cooling during condensation still needs verbal explanation. |
| Website Rebrand | Responsive Fern & Field HTML with embedded artwork and working section links | Browser checked at desktop and 390px. No horizontal page overflow at 390px. |
| Browser Game Builder | Space courier game with artwork, keyboard/pointer handlers, score, shields, timer and restart | Browser showed scoring, shield loss, the 45-second end state, and reset. Mobile layout fits 390px. |
| Product Photo to Campaign Scene | Reference-based product edit, original/result comparison, review report | Review found the scene usable and identified lighting/color shifts. Exact product preservation is not guaranteed. |
| Instructions to Visual Guide | Six source-matching steps, full text, generated card, bounded correction and final review | Still a draft requiring visual review: test images exposed pot/root-ball continuity and soil-depth illustration ambiguity. Do not present it as an approved procedural reference. |
| Coordinated Campaign Visuals | Two coordinated editorial images generated in parallel with a reviewed invitation | Palette and purpose match; clothing/props differ between views. Not an exact continuation of one scene. |
| Image to 180° Equirectangular | Square image plus actual original/result review | **Approximate only.** Test altered room geometry and introduced polar artifacts. PF-083 remains open; prompt-only generation does not establish calibrated projection. |

## Validation and privacy

Validation: **110 backend tests, 50 frontend tests and 28 CLI tests passed**, including the installed-CLI test. The isolated production Worker build and deployment succeeded. Regression coverage includes exported-bundle execution, installed CLI execution, schema parity, source checks, report escaping, file traversal and CSV formula protection, private artifact access, pricing, parallel steps, settings and execution recovery. Real outputs remain under the local, untracked `tmp/workflow-quality/` QA directory; no personal output URLs or credentials are included in this report.

Anonymous requests to the new hosted report and ZIP URLs returned 404 with `private, no-store` headers. Existing synthetic public samples are labeled as **version 1.2**; they are not presented as proof of this release's extra checks.

The hosted tests reserved **414 PromptFlow tokens**: 374 for the lesson and research attempts, plus 40 for a final Meeting Action Plan run that verified the new report and ZIP in production. Local runs used the already configured provider key and incurred provider charges rather than PromptFlow token deductions. The local ledger records attempts and elapsed time, not a measured dollar receipt. The user expressly authorized additional real-provider testing.

## Remaining work

1. Implement calibrated geometry, masked generation and reprojection for accurate panoramas (PF-083).
2. Add bounded full-page source retrieval and claim-to-document verification for deeper research.
3. Add task-specific image evaluation sets; the model reviewing an image can itself miss defects. Preserve human review for procedural, scientific and product-fidelity use.
4. Exercise more adversarial and longer inputs. These twelve synthetic examples establish working paths, not universal reliability.

Agents, Cron and other previously deferred features remain outside this release.

Backend source: `580e38e`; deployed Worker: `8c5ae413-5bb1-4caa-859c-0cf121996da4`. The final hosted action-plan run completed with the formatted report and matching editable files.
