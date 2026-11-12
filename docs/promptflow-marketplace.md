# Marketplace implementation — November 11, 2026

Local changes; not deployed. Individual purchases use the existing PromptFlow token balance. Subscribers retain included downloads. Run costs are separate from the one-time unlock, and a purchase does not start a run.

| Workflow | One-time tokens | Input / useful output |
|---|---:|---|
| Image to 180° Equirectangular | 24,000 | Uploaded image → AI-assisted square mono panorama and HTML review sheet |
| Research Brief | 12,000 | Question → sourced brief and next steps |
| Meeting Action Plan | 6,000 | Notes → decisions, owners, actions and recap draft |
| Feedback Compass | 10,000 | Feedback → evidenced themes and improvement backlog |
| Launch Campaign Kit | 10,000 | Product brief → consistent channel drafts and rollout |
| Visual Lesson Pack | 16,000 | Topic → sourced lesson, generated diagram and printable HTML |
| Client Proposal Builder | 10,000 | Client brief → scope, milestones and assumptions |

Prices reflect utility and workflow complexity. They are configured on the server in `MARKETPLACE_PRICES`, not accepted from the browser. Every listing has a generated cover. The Marketplace folder icon uses the site's existing black-and-gold style; cover illustrations are clearly labeled as illustrations, not actual outputs. [Asset provenance and prompts](promptflow-marketplace-assets.json).

## Access and purchases

The public catalog exposes descriptions and activities, not the executable prompts. Downloads and workspace installation require authenticated subscription or purchased ownership. A unique `(user_id, workflow_id)` receipt and a D1 transaction couple token deduction with ownership; repeated/concurrent requests cannot charge the same account twice. Insufficient funds cannot create ownership. Database failure rolls both operations back. Canceled subscriptions do not remove separately purchased ownership. Subscription access follows the existing active/past-due grace policy.

The UI shows the exact token cost and resulting balance before confirmation. Owned workflows can be downloaded repeatedly. “Use in PromptFlow” creates an idempotent private copy, preserves later user edits and opens the typed input collector. The normal review, explicit run confirmation, progress and output renderer handle execution.

## Image conversion and downloadable runtime

The first workflow sends the uploaded photo as the primary image and the user's unmodified projection guide as the second image to OpenAI's [image edits endpoint](https://developers.openai.com/api/reference/resources/images/methods/edit). The guide is included in the bundle as `assets/vr180-guide.png`, with `instructions.html` and a README pointer. The same asset ships when an installed copy is exported, including in nested bundles. Hosted and Python runtimes both support image edits; a missing source fails before a provider request. The CLI ZIP and embedded runtime have been rebuilt (CLI 0.3.1).

Output is an **AI-assisted approximate** 1024×1024 monoscopic half-equirectangular texture, 180° horizontal × 180° vertical. Unseen areas are synthesized. The supplied guide explains directions; its rectangular aspect ratio is not the square output format. This is not calibrated geometry, stereo VR180, a 360° panorama or headset-specific metadata. Review in a 180° mono viewer before use. A deterministic projection/calibration stage is recommended if exact geometric fidelity is required.

## Verification and limits

- Backend Marketplace tests exercise seven exported bundles through actual preflight and step execution with controlled provider responses; source and guide are both checked in the image-edit payload.
- SQL-backed tests check duplicate/concurrent attempts, balance, receipts, rollback, subscriber bypass, cross-account access, price validation and private-copy preservation.
- Existing UI and CLI regression suites pass; backend Wrangler dry-run builds successfully. No live payment, paid provider call or production mutation was made for this verification.
- Chrome localhost QA verifies the token confirmation and owned state, subscriber access, file upload and run review, and visible fixture outputs. Generated output quality and provider-account availability still need a bounded production test after deployment.
- Learn More commands wrap instead of horizontally scrolling; the home wordmark remains visible at 664×532 and 390×844. QA screenshots are under `docs/qa/marketplace/` and are not trademark specimens.

## Deployment

The live frontend is **GitHub Pages** for `PotentiallyARobot/MissingLink`, published from `main` at `/` to `www.missinglink.build`. The Cloudflare backend forwards frontend requests on `missinglink.build` to that site. Running `npx wrangler deploy` in `C:/missinglink-backend` updates only the backend; the untracked frontend `wrangler.jsonc` is not the production Pages publishing configuration.

Push the frontend commit, then check the repository's [Pages build and deployment workflow](https://github.com/PotentiallyARobot/MissingLink/actions/workflows/pages/pages-build-deployment). A successful push is not confirmation that Pages published it. Verify the workflow's commit, the Marketplace button at `/promptflow`, and HTTP 200 for `/assets/promptflow-marketplace.js`. If Pages reports a stale `building` state without an Actions run, request a fresh Pages build through the GitHub Pages API (`POST /repos/PotentiallyARobot/MissingLink/pages/builds`) and follow it through deployment. Do not rerun an older successful workflow, which would publish its older commit.

Deploy the backend with `promptflow_marketplace.ts`, `promptflow_marketplace_store.ts`, `promptflow_vr180_asset.ts`, updated core/routes/runtime and generated `promptflow_local_runtime.ts`. Schema bootstrap creates `promptflow_marketplace_purchases`; no Stripe product or checkout setup is needed for workflow purchases.

Deploy frontend `promptflow.html`, `promptflow_learn_more.html`, both `assets/promptflow-marketplace.*` files, the entire `assets/promptflow-marketplace/` image folder, `promptflow_icons_transparent/16_marketplace_folder_storefront.png`, `promptflow-cli.zip` and `examples/text-summary.promptflow`. Existing provider secrets continue to apply; the image workflow uses OPENAI_API_KEY.

Rebuild commands from the frontend folder when runtime/examples change:

```powershell
python scripts/build-promptflow-cli.py --backend C:/missinglink-backend
node scripts/build-promptflow-examples.mjs C:/missinglink-backend
python scripts/build-promptflow-cli.py --backend C:/missinglink-backend
```

First build refreshes the backend runtime; second exports matching examples; final build includes those examples in the CLI ZIP. Verify a signed-in public deployment, one token unlock/re-download, subscriber inclusion and a bounded real image conversion before calling production verified. Capture trademark evidence only from the deployed real offering; see [statement-of-use notes](promptflow-statement-of-use-notes.md).
