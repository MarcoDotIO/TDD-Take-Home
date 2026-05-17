# COLA Dataset (250 Applications)

Generated from COLA Cloud API data.

## Files

- `applications.jsonl`: one application per line, includes text fields and local image paths.
- `applications.csv`: flattened table of key product/application fields.
- `ttb_ids.txt`: list of collected TTB IDs in ingestion order.
- `images/<ttb_id>/...`: downloaded label images from COLA image URLs.
- `summary.json`: run metadata and request counters.

## Notes

- Applications were required to have at least one downloadable image.
- Image paths in metadata are relative to this dataset directory.
