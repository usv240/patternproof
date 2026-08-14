# Asset provenance

## Application UI and seeded demo

| Asset | Source | Licence / rights | Use |
|---|---|---|---|
| UI copy and layout | Original project work | Project-owned | Application screens |
| `public/demo/reference-olive.jpg` | Byte-exact public copy of `test-assets/qa-garment-worn.jpg` | Project-authorized synthetic fixture; fictional adult | Public demo garment reference; SHA-256 `bdac93a07a670da973fed37e648d54474410f37778334c0516599492a2070a00` |
| `public/demo/render-olive.jpg` | Byte-exact copy of the recorded 2026-08-03 YouCam T3 worn-reference result made exclusively from project-authorized synthetic inputs | Project-authorized synthetic output; no customer data | Public demo visual-intent render; SHA-256 `b53062e7e436dbd96379a9f12d23972c8108c3f454e72ff03dd2483245ef43e9` |
| test-assets/qa-body-front.jpg | OpenAI built-in image generation, commissioned for this repository, 2026-08-03 | Project-authorized synthetic fixture; fictional adult | Clean VTO source QA |
| test-assets/qa-garment-worn.jpg | OpenAI built-in image generation, commissioned for this repository, 2026-08-03 | Project-authorized synthetic fixture; fictional adult | Worn-reference robustness QA |
| test-assets/qa-garment-angled-cropped.jpg | OpenAI built-in edit of the preceding synthetic garment fixture, 2026-08-03 | Project-authorized synthetic fixture; fictional adult | Crop/angle robustness QA |
| test-assets/qa-garment-low-light.jpg | OpenAI built-in image generation, commissioned for this repository, 2026-08-03 | Project-authorized synthetic fixture; fictional adult | Low-light robustness QA |
| test-assets/qa-body-poor-cropped-dark.jpg | Local crop and exposure transformation of qa-body-front.jpg | Same project-authorized source | Poor-input failure-handling QA |

No third-party images, logos, trademarks, music, or scraped visual assets are included. The synthetic fixtures and public demo contain no real customer data. The public render is the recorded T3 worn-reference result; its byte identity is pinned above so the displayed public proof cannot silently drift.

## Submission screenshots

Captured from the public production origin on 2026-08-14 at 1440 x 1100. These images show only public, synthetic, credential-free application states.

| Asset | Screen | SHA-256 |
|---|---|---|
| `submission/screenshots/01-landing.png` | Product landing and primary judge path | `3a0309fa8b15d08424b5183df26a324430448b812a3f57223cfe9f76cb1d8afd` |
| `submission/screenshots/02-unified-create.png` | Unified sample/private creation entry | `36dbd575cad4712b0243a9793d3345530784f87a04557d46957e88ed18205921` |
| `submission/screenshots/03-privacy-boundary.png` | Privacy and image-handling contract | `4fb3a4937da34df84aa6e6add31636feca7833e47193c62cec4ac31bfdbf625a` |
| `submission/screenshots/04-evidence-ledger.png` | Public technical evidence ledger | `c20599d2ce832015ae0324fd1c6de1616da09093d508f819c7028653be977193` |
| `submission/screenshots/05-immutable-cut-card.png` | Immutable synthetic public Cut Card | `6e4f8937da5ae1de8aad0434c6ad6e46b0de4e29f1b502410a27cee2d9a0aeb9` |

## Generation prompt record

- Clean body: fictional adult, centered head-to-toe on a warm-gray studio background, neutral pose, fitted charcoal T-shirt and dark leggings, even frontal light, no props/logos/text.
- Worn garment: fictional adult in an ankle-length olive wrap dress with cream piping, two cream waist buttons, elbow sleeves, tied waist and pleated A-line skirt, catalog lighting, no props/logos/text.
- Angled/cropped reference: edit of the worn-garment fixture preserving the dress while introducing imperfect crop, oblique framing, and mild phone-camera character.
- Low-light reference: fictional adult in the same distinctive olive/cream wrap-dress design, dim fitting-room phone exposure, full garment visible, no props/logos/text.