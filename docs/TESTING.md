# Testing

The requested first pass adds tests but does not run them.

Run later with:

```bash
bun test
```

## Test Groups

- Dataset integrity: verifies `.codex/cola_cloud_250` summary counts, CSV/JSONL/TTB ID consistency, required fields, and local image paths.
- Golden accepted decisions: converts all 250 accepted records into internal submissions and asserts no hard rejection.
- Tolerance: verifies optional missing fields and known category-family noise route to review rather than rejection.
- Synthetic negatives: verifies real rejection paths without misusing the accepted dataset.
- API unit tests: verifies applicant/admin auth boundaries and mocked email side effects.

AWS credentials are not required for tests. SES is mocked via an in-memory capture provider.
