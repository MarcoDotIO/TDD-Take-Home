import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BeverageType, ColaImage, ColaSubmission } from "./types";

export interface ColaCloudDatasetRow {
  ttb_id: string;
  cola: Record<string, unknown>;
  images: Array<Record<string, unknown>>;
  ingested_at_utc: string;
}

export interface ColaCloudDataset {
  baseDir: string;
  summary: {
    target: number;
    collected: number;
    download_counts: {
      applications: number;
      images: number;
    };
  };
  rows: ColaCloudDatasetRow[];
  csvRows: Record<string, string>[];
  ttbIds: string[];
}

export function loadColaCloudDataset(baseDir = resolve(process.cwd(), ".codex/cola_cloud_250")): ColaCloudDataset {
  const summary = JSON.parse(readFileSync(join(baseDir, "summary.json"), "utf8"));
  const rows = readJsonl(join(baseDir, "applications.jsonl")) as ColaCloudDatasetRow[];
  const csvRows = readCsv(join(baseDir, "applications.csv"));
  const ttbIds = readFileSync(join(baseDir, "ttb_ids.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return { baseDir, summary, rows, csvRows, ttbIds };
}

export function datasetRowToSubmission(row: ColaCloudDatasetRow): ColaSubmission {
  const cola = row.cola;
  return {
    id: stringValue(cola.ttb_id) || row.ttb_id,
    applicantId: "fixture-applicant",
    applicantEmail: "fixture-applicant@example.gov",
    brandName: requiredString(cola.brand_name, "brand_name"),
    productName: requiredString(cola.product_name, "product_name"),
    productType: beverageType(cola.product_type),
    className: requiredString(cola.class_name, "class_name"),
    originName: requiredString(cola.origin_name, "origin_name"),
    domesticOrImported: domesticOrImported(cola.domestic_or_imported),
    abv: numberValue(cola.abv),
    volume: numberValue(cola.volume),
    volumeUnit: stringValue(cola.volume_unit),
    barcodeValue: stringValue(cola.barcode_value),
    llmCategory: stringValue(cola.llm_category),
    llmCategoryPath: stringValue(cola.llm_category_path),
    images: row.images.map(toImage),
    submittedAt: row.ingested_at_utc,
    status: "submitted"
  };
}

export function imagePathExists(baseDir: string, image: ColaImage): boolean {
  return Boolean(image.localPath && existsSync(join(baseDir, image.localPath)));
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readCsv(path: string): Record<string, string>[] {
  const records = parseCsvRecords(readFileSync(path, "utf8")).filter((record) =>
    record.some((value) => value.trim().length > 0)
  );
  const headers = records[0] ?? [];
  return records.slice(1).map((values) => {
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      values.push(current);
      records.push(values);
      values = [];
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  records.push(values);
  return records;
}

function toImage(raw: Record<string, unknown>): ColaImage {
  return {
    id: requiredString(raw.ttb_image_id, "ttb_image_id"),
    localPath: stringValue(raw.local_path),
    url: stringValue(raw.image_url),
    position: stringValue(raw.container_position),
    widthPixels: numberValue(raw.width_pixels),
    heightPixels: numberValue(raw.height_pixels)
  };
}

function requiredString(value: unknown, field: string): string {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(`Missing required dataset field: ${field}`);
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function beverageType(value: unknown): BeverageType {
  if (value === "distilled spirits" || value === "malt beverage" || value === "wine") return value;
  return "unknown";
}

function domesticOrImported(value: unknown): ColaSubmission["domesticOrImported"] {
  if (value === "domestic" || value === "imported") return value;
  return "unknown";
}
