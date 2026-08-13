# YouCam validation fixtures

These five synthetic, fictional-person fixtures are safe to commit and are only for API quality testing. They are not customer examples or claims of actual output quality.

| File | Gate | Intended stress |
|---|---|---|
| qa-body-front.jpg | T2/T3 | Clean, forward, full-body source |
| qa-garment-worn.jpg | T3 | Reference garment worn by another adult |
| qa-garment-angled-cropped.jpg | T3 | Cropped, imperfect reference |
| qa-garment-low-light.jpg | T3 | Underexposed phone-style reference |
| qa-body-poor-cropped-dark.jpg | T4 | Partial, dark body source expected to fail cleanly or produce unusable output |

The four source images were created specifically for PatternProof with OpenAI's built-in image-generation tool on 2026-08-03. The poor-body fixture is a deterministic crop/darkening of qa-body-front.jpg. Prompts and provenance are recorded in ASSETS.md.

Never place a real customer photo here. Private real-world tests must use consented uploads through the application and must not be committed, screen-recorded, or reused.