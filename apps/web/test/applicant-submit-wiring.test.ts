import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8");

describe("applicant submission wizard wiring", () => {
  test("does not rely on native form submission for COLA application creation", () => {
    expect(source).toContain('<section className="usa-card submission-card" id="application-form"');
    expect(source).not.toContain('<form className="usa-card submission-card" id="application-form"');
    expect(source).not.toContain("onSubmit={submitApplication}");
    expect(source).toContain('onClick={() => void submitApplication()}');
    expect(source).toContain('type="button" className="usa-button usa-button--primary" onClick={() => void submitApplication()}');
  });
});
