# Local PDF Readability Fix

## Behavior

- Read a selected invoice file once in the browser and reuse that buffer for PDF parsing and attachment generation.
- Replace raw local file-read exceptions with a controlled retry message.
- The default local dev command must serve the built UI through the Pages Functions runtime so `/analyze-invoice` exists locally.

## Validation

- Run the Pages Functions runtime for local invoice analysis; Vite alone serves only the UI.
