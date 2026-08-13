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

## Generation prompt record

- Clean body: fictional adult, centered head-to-toe on a warm-gray studio background, neutral pose, fitted charcoal T-shirt and dark leggings, even frontal light, no props/logos/text.
- Worn garment: fictional adult in an ankle-length olive wrap dress with cream piping, two cream waist buttons, elbow sleeves, tied waist and pleated A-line skirt, catalog lighting, no props/logos/text.
- Angled/cropped reference: edit of the worn-garment fixture preserving the dress while introducing imperfect crop, oblique framing, and mild phone-camera character.
- Low-light reference: fictional adult in the same distinctive olive/cream wrap-dress design, dim fitting-room phone exposure, full garment visible, no props/logos/text.