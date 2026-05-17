import { describe, expect, test } from "bun:test";
import { datasetRowToSubmission, evaluateSubmission, imagePathExists, loadColaCloudDataset } from "../src";
import { normalizeLooseText, productFamilyFromCategoryPath, productFamilyFromType, textEquivalent } from "../src/normalization";

const dataset = loadColaCloudDataset();

describe("COLA Cloud accepted dataset integrity", () => {
  test("summary and row counts describe 250 accepted applications", () => {
    expect(dataset.summary.collected).toBe(250);
    expect(dataset.summary.download_counts.applications).toBe(250);
    expect(dataset.summary.download_counts.images).toBe(411);
    expect(dataset.rows).toHaveLength(250);
    expect(dataset.csvRows).toHaveLength(250);
    expect(dataset.ttbIds).toHaveLength(250);
  });

  test("all JSONL applications are approved and have required accepted-case fields", () => {
    for (const row of dataset.rows) {
      expect(row.cola.application_status).toBe("approved");
      expect(row.ttb_id).toMatch(/^\d+$/);
      expect(row.cola.ttb_id).toBe(row.ttb_id);
      expect(row.cola.brand_name).toBeString();
      expect(row.cola.product_name).toBeString();
      expect(row.cola.product_type).toBeString();
      expect(row.cola.class_name).toBeString();
      expect(row.cola.origin_name).toBeString();
      expect(row.cola.domestic_or_imported).toBeString();
      expect(row.cola.llm_category).toBeString();
      expect(row.cola.llm_category_path).toBeString();
      expect(row.images.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("every declared local label image exists", () => {
    for (const row of dataset.rows) {
      const submission = datasetRowToSubmission(row);
      for (const image of submission.images) {
        expect(imagePathExists(dataset.baseDir, image), `${row.ttb_id} missing ${image.localPath}`).toBe(true);
      }
    }
  });

  test("CSV and JSONL contain the same TTB IDs", () => {
    const jsonIds = new Set(dataset.rows.map((row) => row.ttb_id));
    const csvIds = new Set(dataset.csvRows.map((row) => row.ttb_id));
    expect(csvIds).toEqual(jsonIds);
    expect(new Set(dataset.ttbIds)).toEqual(jsonIds);
  });
});

describe("COLA Cloud accepted dataset golden decisions", () => {
  test("no known-accepted row receives an automated hard rejection", () => {
    for (const row of dataset.rows) {
      const submission = datasetRowToSubmission(row);
      const decision = evaluateSubmission(submission, undefined, { requireExtraction: true });
      expect(decision.status, `${row.ttb_id} should not be rejected`).not.toBe("rejected");
      expect(["approved", "needs_review"]).toContain(decision.status);
    }
  });

  test("known category noise routes to review rather than rejection", () => {
    const noisyRows = dataset.rows.filter((row) => {
      const typeFamily = productFamilyFromType(String(row.cola.product_type));
      const categoryFamily = productFamilyFromCategoryPath(String(row.cola.llm_category_path));
      return typeFamily !== "Unknown" && categoryFamily !== "Unknown" && typeFamily !== categoryFamily;
    });

    expect(noisyRows.length).toBeGreaterThan(0);
    for (const row of noisyRows) {
      const decision = evaluateSubmission(datasetRowToSubmission(row));
      expect(decision.status).toBe("needs_review");
      expect(decision.evidence.some((item) => item.field === "llmCategoryPath" && item.severity === "review")).toBe(true);
    }
  });

  test("accepted rows tolerate optional missing ABV, volume, and barcode fields", () => {
    const missingOptionalRows = dataset.rows.filter(
      (row) => row.cola.abv == null || row.cola.volume == null || row.cola.barcode_value == null
    );
    expect(missingOptionalRows.length).toBeGreaterThan(0);

    for (const row of missingOptionalRows) {
      const decision = evaluateSubmission(datasetRowToSubmission(row));
      expect(decision.status, `${row.ttb_id} optional missing field should not reject`).not.toBe("rejected");
    }
  });
});

describe("accepted-field normalization tolerance", () => {
  test("normalizes casing, punctuation, and whitespace for harmless brand/product differences", () => {
    expect(textEquivalent("STONE'S THROW", "Stone's Throw")).toBe(true);
    expect(textEquivalent("OLD TOM DISTILLERY", "old tom distillery")).toBe(true);
    expect(normalizeLooseText("  Clase-33: Tequila Blanco ")).toBe("clase 33 tequila blanco");
  });
});
