const PUNCTUATION_RE = /[\u2018\u2019'".,/:;()[\]{}_-]+/g;
const WHITESPACE_RE = /\s+/g;

export function normalizeLooseText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(PUNCTUATION_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

export function textEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeLooseText(left);
  const b = normalizeLooseText(right);
  return a.length > 0 && a === b;
}

export function normalizeVolumeUnit(unit: string | null | undefined): string | undefined {
  const normalized = normalizeLooseText(unit);
  if (!normalized) return undefined;
  if (["ml", "milliliter", "milliliters"].includes(normalized)) return "milliliters";
  if (["l", "liter", "liters"].includes(normalized)) return "liters";
  if (["floz", "fl oz", "fluid ounce", "fluid ounces"].includes(normalized)) return "fluid ounces";
  return normalized;
}

export function numbersClose(left: number | undefined, right: number | undefined, tolerance = 0.01): boolean {
  if (left === undefined || right === undefined) return false;
  return Math.abs(left - right) <= tolerance;
}

export function productFamilyFromCategoryPath(path: string | null | undefined): "Beer" | "Liquor" | "Wine" | "Unknown" {
  const first = (path ?? "").split(">").at(0)?.trim().toLowerCase();
  if (first === "beer") return "Beer";
  if (first === "liquor") return "Liquor";
  if (first === "wine") return "Wine";
  return "Unknown";
}

export function productFamilyFromType(type: string | null | undefined): "Beer" | "Liquor" | "Wine" | "Unknown" {
  const normalized = normalizeLooseText(type);
  if (normalized === "malt beverage") return "Beer";
  if (normalized === "distilled spirits") return "Liquor";
  if (normalized === "wine") return "Wine";
  return "Unknown";
}

export const GOVERNMENT_WARNING_PREFIX = "GOVERNMENT WARNING:";

export function hasGovernmentWarning(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes(GOVERNMENT_WARNING_PREFIX);
}
