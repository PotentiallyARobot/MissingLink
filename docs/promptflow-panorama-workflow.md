# Front Hemisphere — accurate 180° mono workflow specification

User choice confirmed November 12, 2026: **180° horizontal × 180° vertical, monoscopic, square**. This document specifies the next implementation. The deployed Marketplace recipe still makes one guided image edit; it does not implement the geometric stages below.

## What accuracy means

A single photo cannot reveal what was outside its camera view. Preserve the observed scene, compute the projection exactly, and identify the remaining area as synthesized. More captured views from the same optical center improve factual accuracy more than unrelated example panoramas. A 2:1 texture conventionally covers 360° × 180°; resizing a 180° square to that ratio distorts its angular scale. Stereo is a separate capture/reconstruction problem and must not be faked by duplicating an eye.

Recommended product name: **Front Hemisphere — Photo to 180° Panorama**.

## Recommended pipeline

| Stage | Method | Output / acceptance |
|---|---|---|
| 1. Establish the camera | Read orientation and available lens/FOV metadata; let the user adjust horizontal FOV and horizon. A vision calibration model can suggest values but must report uncertainty. Use the original photograph, not a regenerated front view. | Camera intrinsics, level rotation, original pixels. Unknown FOV is a disclosed assumption. |
| 2. Place the source on the hemisphere | Inverse-project the photograph into a canonical spherical atlas using its camera parameters. Maintain a source-coverage mask and a separate synthesized-coverage mask. | Source content at the correct angles; blank regions have explicit masks. |
| 3. Plan the surroundings | One vision/text pass describes scene layout, ground/ceiling, lighting, visible boundaries and constraints. Ask for a scene plan, not hidden reasoning. | Structured scene constraints shared by all image edits. |
| 4. Generate missing directions | Render overlapping perspective views from the current atlas. Generate/inpaint only unknown pixels with OpenAI Images. Use the original photo and existing neighboring projections as references. Work in small angular increments, prioritizing views with substantial known overlap. | Left, right, up and down are rotations about the same camera center. Generated views never introduce dolly, translation, zoom or a second viewpoint. |
| 5. Preserve and merge | Composite original/accepted pixels back after every model call, even when a model changes them. Reproject the newly generated pixels into the atlas. Use overlap for color/seam correction only; do not average grossly misaligned architecture into a blurry seam. | Original source stays protected; every generated pixel has a camera transform and coverage record. |
| 6. Validate and repair locally | Render forward/left/right/up/down and seam-crossing perspective checks. Detect uncovered pixels, reversed axes, horizon jumps, repeated subjects, discontinuous lines, pole artifacts and reference-scene leakage. A vision review supplements numerical checks. | Retry only failed regions, within the approved budget. Do not automatically declare an AI review geometrically correct. |
| 7. Export and inspect | Deterministically sample the atlas into a square half-equirectangular PNG. Provide an interactive 180° mono viewer and a report with camera assumptions and coverage. | A private PNG, private review report and optional private directional previews. |

Start near the known view and expand outward; five independent “look left/right/up/down” prompts are not sufficient. A practical first implementation can use 90–110° perspective work views with overlapping yaw/pitch steps of roughly 40–55°, selected according to remaining coverage. The exact schedule should be coverage-driven rather than a fixed five-call promise. Top and bottom need shared anchors too: generate the roof/sky and floor/ground consistently before completing their side connections.

Do not use an unconstrained model-generated cubemap collage as the geometry source. Cell borders, face orientation and FOV may only look correct. Geometry comes from the renderer and masks.

## Coordinate contract

Use +X right, +Y up, +Z forward. One camera center C=(0,0,0). For an N×N output at pixel centers:

```text
longitude λ = π * ((x + 0.5) / N - 0.5)
latitude  φ = π * (0.5 - (y + 0.5) / N)
direction d = (cos φ sin λ, sin φ, cos φ cos λ)
```

Left edge approaches −90° longitude; right approaches +90°; the center faces forward. Top approaches the zenith, bottom the nadir. Never join the left and right boundaries as a 360° seam. Near a pole, samples converge to the same direction; they must not become five different ceilings.

For a perspective source, transform d into its calibrated camera frame, require positive camera Z, then sample `u=fx*X/Z+cx`, `v=cy-fy*Y/Z` when inside its bounds. Use antialiased resampling and masks. Preserve the original source at export by resampling it directly, avoiding repeated warp degradation.

This is a spherical appearance reconstruction for one viewpoint. Depth estimation or a 3D scene is optional for camera motion; it is not necessary for exact rotational panorama projection and adds assumptions. If walkable 3D or stereo is wanted later, treat that as a different workflow.

## References that teach the mapping

Keep the supplied direction diagram in the download. Add a small, curated set of real scenes as **paired examples**: a square front-hemisphere crop plus correctly rendered perspective views at known yaw/pitch/FOV. Label the pairs as projection examples, never as target scenery. These are more useful than unrelated equirectangular images alone. Only send the relevant one or two examples to the model to limit cost and prevent style/content leakage.

Candidate assets: [Poly Haven Studio](https://polyhaven.com/a/poly_haven_studio) for walls/ceiling/floor and [Modern Buildings](https://polyhaven.com/a/modern_buildings) for horizon/sky/architecture. Poly Haven's [asset license](https://polyhaven.com/license) permits commercial reuse and redistribution under CC0. Record source, author, license, crop orientation, render transforms and checksums alongside packaged examples. These assets are candidates; they have not yet been downloaded or packaged.

Use synthetic calibrated grids, straight corridors and labeled axes for automated geometry tests. Use licensed real panoramas as held-out evaluation data: extract a perspective input, run the workflow, and compare its known region and directional views against the original. Hidden content has many plausible answers; do not claim an exact factual reconstruction merely from image similarity.

## Cost, progress and privacy

- Quote the planned image calls, reference input allowances, analysis/review calls and maximum repair allowance before confirmation. Every provider call counts; the actual schedule may need fewer calls than its cap. Resume accepted views rather than regenerate the full scene.
- Show concrete activity: “Calibrating camera,” “Preserving source pixels,” “Generating upper-left surroundings,” “Checking overlap,” “Projecting to 180°,” “Preparing private download.”
- Keep inputs, masks, intermediate directions, final image and report owner-only. Send images directly to provider requests. Do not include signed provider capabilities in stored outputs, browser history or downloadable reports.
- Deliver the format explicitly as **180° mono · 1:1 · half-equirectangular**. Offer a 2048×2048 export once sufficient source/generated angular resolution exists; upscaling alone does not add geometric accuracy.

## Implementation and release gates

The current Worker has image generation and document assembly but no calibrated image renderer/mask compositor. Implement that deterministic service and a corresponding local runtime implementation before replacing the Marketplace workflow. Cloudflare Workers must not perform unbounded multi-megapixel pixel loops on the request thread; use a bounded image-processing job/service. The downloadable workflow needs the same camera contract, masks, orientation tests and dependency checks. Adding prompts alone must not be described as this implementation.

Required release tests: source-preservation round trip; axis orientation; complete hemisphere coverage; pole convergence; no false left/right seam; overlap continuity; portrait/landscape/rotated sources; missing EXIF and user FOV override; all-private authenticated download/reload; interruption/resume; maximum call/token budget; a realistic room and outdoor scene viewed interactively. Inspect visual quality separately from “the API returned an image.”

Relevant primary references: [FFmpeg v360 projection controls](https://ffmpeg.org/ffmpeg-filters.html#v360), [Perspective Fields for Single Image Camera Calibration](https://openaccess.thecvf.com/content/CVPR2023/html/Jin_Perspective_Fields_for_Single_Image_Camera_Calibration_CVPR_2023_paper.html), [A Recipe for Generating 3D Worlds from a Single Image](https://openaccess.thecvf.com/content/ICCV2025/html/Schwarz_A_Recipe_for_Generating_3D_Worlds_from_a_Single_Image_ICCV_2025_paper.html). The workflow above is an engineering recommendation to validate, not a benchmark claim that OpenAI Images is the most accurate available panorama model.
