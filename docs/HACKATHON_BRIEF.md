# Manycore Aholo Global 3D AI Hackathon — Brief

Source: https://www.aholo.ai/hackathon (read 2026-11-18), API docs at https://labs.aholo.ai/api-docs/en

## Hard facts

| Item | Detail |
|---|---|
| Submission deadline | **Thu 19 Nov 2026, 6:00 a.m. EST** = **4:30 p.m. IST** (≈23.5 h from 18 Nov 17:00 IST) |
| Team roster lock | Same moment as the deadline |
| Judging | 20–30 Nov; results early Dec 2026 |
| Format | Online, open worldwide; teams of 1–3 (solo players must still create a team) |
| Tracks | None — any use of AI-generated 3D |
| Required tool | **Aholo Lux3D** must create core 3D content or support a key part of the workflow |
| Optional tools | Aholo API (World generation/reconstruction, RenderCloud, Lux3D API), LuxReal (AI video), third-party tools |
| IP | Participants keep rights to their original work; third-party assets must be licensed |

## Credits

- One-time **registration credits** after individual registration.
- **Team credits** after the team is formed **and submits its project idea**; split equally among members listed when the team is first confirmed (later joiners get none).
- Aholo Labs API has its own free starter credit + pay-as-you-go; API keys at https://labs.aholo.ai/api-keys.
- Publishing on ModelScope + submitting the link → +20 h Notebook GPU (optional).

## What to submit

| Item | Status | Notes |
|---|---|---|
| Project report (PDF or PPT) | Required | Idea → result, process screenshots, asset-iteration comparisons, final images |
| Working demo (link or video) | Required | Video may be edited/voiced but must show the real project running |
| X post with `#Manycorehackathon` | Bonus (feeds the 5 % Reach score) | Must stay public until results |
| Source code | Bonus | Link or archive |

## Judging (final = 70 % expert panel + 30 % community panel of 50 AI practitioners)

| Weight | Criterion | What it means for us |
|---|---|---|
| 30 % | Use of Manycore tools | Lux3D must be *central*, not just an asset source. Chain several APIs. |
| 25 % | Fun & engagement | Gameplay must be fun; the demo video must show highlights that spread. |
| 20 % | Innovation | New interaction/concept vs existing products. |
| 20 % | Completeness | Core loop complete, demo runs reliably, materials match the project. |
| 5 % | Reach | X post with the hashtag. |

Expert panel includes Manycore's CEO and AI-3D director, a former WoW team lead (Grummz), Robert Scoble, academics in 3D vision/embodied AI, and many AI-tech influencers.

## Prizes (¥320,000 total)

Special Award ¥100k ×1 · First ¥50k ×1 · Second ¥30k ×2 · Third ¥10k ×3 · Application awards ¥5k ×5 (incl. **Gaming**) · Creativity awards ¥5k ×5 (VC Magnet, Technical Excellence, Wild Idea, Most Useless, Making the World Better) · Popularity ¥5k ×2.

The organisers' own example demos are adventure/flying minigames that use Lux3D assets as scenery — that is the baseline to beat.

## Platform capabilities (from the API docs)

- Gateway `https://api.aholo.ai`, routes prefixed `/global`, header `Authorization: <API key>` (no `Bearer`).
- **Lux3D** (async create → poll → download):
  - multimodal image (prompt and/or image → image), image → four views
  - image → 3D, text → 3D (optional reference image); models **G1** / **G1-Turbo**
  - `faceCount` 10k–300k, `outputFormat` zip / glb / ply, `aiPredictSize` (real-world size prediction)
  - text-to-3D styles: photorealistic, cartoon, anime, hand_painted, cyberpunk, fantasy, glass
  - material transfer, multi-format export (USDZ/OBJ/FBX/STL/3MF), **part split**, **articulation animation from a motion prompt**, **humanoid auto-rig**, **animation retarget** (1–10 preset motions → GLB/FBX)
  - result is a ZIP (GLB + PBR textures); result URL valid for 2 h
  - reported generation time "as fast as ~20 s" (36Kr review; unverified for G1-Turbo)
- **World** (3D Gaussian splats): generation from text and/or one image (indoor scenes most reliable; outdoor is beta), reconstruction from ≥20 photos / video / Insta360. Outputs PLY / SPZ (+ LOD), panorama.
- **Aholo Viewer** (aholojs.dev): MIT-licensed web 3DGS renderer with LOD streaming, walk mode, voxel/mesh collision.
- **RenderCloud**: OpenUSD offline/realtime cloud rendering.
- SDKs: Python, TypeScript (`@manycore/aholo-sdk-*`), official MCP server `@manycore/aholo-sdk-mcp` (env `AHOLO_API_KEY`, `AHOLO_REGION=com`) exposing `lux3d_*` and `world_*` tools.

## From the official Participant Handbook (shared on Discord, read 18 Nov)

- **Credits:** 300 per person at registration, plus **3,000 per team** once the team and project topic are submitted.
  More on request: email feedback@official.aholo3d.com with your account ID. **All credits expire 19 Nov, 10:59 a.m. ET**.
- **Top award is the "3D AI New Species Award"** (about US$14,900). It "highlights the positioning of the 3D AI ecosystem".
  Then First (1), Second (2), Third (3), five Application awards (incl. Gaming) and five Creative awards.
- **Review:** staff screening (completeness and validity) → internal panel picks the **Top 50** → experts and player jurors score
  (70/30). Creative awards are voted by players; Application awards are judged by experts.
- **Fun (25%)** is defined as "the gameplay and **spatial interaction**... creative and engaging", plus a video with viral potential.
- **Innovation (20%)**: new concepts and interactions, "rather than simply stacking assets or functions".
- **Lux3D strengths:** wood, stone, metal, plastic, porcelain, leather; objects with clear contours.
  **Weak spots:** transparent materials (glass) are "not sufficiently stable"; character faces and dense foliage are
  "not recommended"; intricate carvings, reliefs and many accessories are unstable; small text blurs.
- **Submission form also asks for:** partner equipment and technology choices, and 1–3 application-award preferences (pick Gaming).
  Links must work without sign-in; include controls and setup instructions. A single model or still renders do not count as a demo.
- **X post:** 30–90 s clip, strongest moment in the first 3 s, readable captions, real running footage. Popularity Award = most
  verified likes by 30 Nov, 4:00 a.m. EST.
- **Optional Manycore tools:** SpatialGen ("explorable 3D worlds" from text/image), Aholo Viewer SDK (load and interact with
  Aholo spatial content), Aholo Reality (reconstruction), LuxReal (AI video).

## Registration flow

1. https://www.aholo.ai/hackathon → **Register now** → sign in (email, Google, Apple, X, Discord or GitHub) and accept the Terms of Use / Privacy Policy.
2. Complete individual registration → registration credits.
3. **My Submission** → create a team (solo is fine) → submit the project idea → team credits.
4. Create an API key at https://labs.aholo.ai/api-keys and store it only in a local `.env` (never commit it).
