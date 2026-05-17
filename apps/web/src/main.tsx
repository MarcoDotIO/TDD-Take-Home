import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import type { ColaSubmission, DecisionStatus } from "@cola/shared";
import {
  createSubmission,
  listAdminSubmissions,
  listApplicantSubmissions,
  overrideSubmission,
  type Session,
  type SubmissionRecord
} from "./api";
import "./styles.css";

const applicantSession: Session = {
  userId: "applicant-local",
  email: import.meta.env.VITE_APPLICANT_EMAIL ?? "applicant@example.gov",
  roles: ["applicant"]
};

const adminSession: Session = {
  userId: "admin-local",
  email: import.meta.env.VITE_ADMIN_EMAIL ?? "admin@example.gov",
  roles: ["admin"]
};

function App() {
  const [mode, setMode] = useState<"applicant" | "admin">("applicant");
  const session = mode === "admin" ? adminSession : applicantSession;

  return (
    <main>
      <header>
        <h1>COLA Verification</h1>
        <div className="segmented">
          <button className={mode === "applicant" ? "active" : ""} onClick={() => setMode("applicant")}>
            Applicant
          </button>
          <button className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>
            Admin
          </button>
        </div>
      </header>
      {mode === "applicant" ? <ApplicantView session={session} /> : <AdminView session={session} />}
    </main>
  );
}

function ApplicantView({ session }: { session: Session }) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState({
    brandName: "OLD TOM DISTILLERY",
    productName: "Kentucky Straight Bourbon Whiskey",
    productType: "distilled spirits" as ColaSubmission["productType"],
    className: "bourbon whisky",
    originName: "kentucky",
    domesticOrImported: "domestic" as ColaSubmission["domesticOrImported"],
    abv: "45",
    volume: "750",
    volumeUnit: "milliliters",
    imageName: "front-label.png"
  });

  async function refresh() {
    setRecords(await listApplicantSubmissions(session));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await createSubmission(session, {
        ...draft,
        abv: Number(draft.abv) || undefined,
        volume: Number(draft.volume) || undefined,
        images: [draftImage(draft.imageName)]
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    }
  }

  return (
    <section className="grid two">
      <form onSubmit={submit}>
        <h2>Submit Application</h2>
        <Field label="Brand" value={draft.brandName} onChange={(brandName) => setDraft({ ...draft, brandName })} />
        <Field label="Product" value={draft.productName} onChange={(productName) => setDraft({ ...draft, productName })} />
        <label>
          Type
          <select value={draft.productType} onChange={(event) => setDraft({ ...draft, productType: event.target.value as ColaSubmission["productType"] })}>
            <option value="distilled spirits">Distilled spirits</option>
            <option value="malt beverage">Malt beverage</option>
            <option value="wine">Wine</option>
          </select>
        </label>
        <Field label="Class" value={draft.className} onChange={(className) => setDraft({ ...draft, className })} />
        <Field label="Origin" value={draft.originName} onChange={(originName) => setDraft({ ...draft, originName })} />
        <label>
          Domestic or imported
          <select
            value={draft.domesticOrImported}
            onChange={(event) => setDraft({ ...draft, domesticOrImported: event.target.value as ColaSubmission["domesticOrImported"] })}
          >
            <option value="domestic">Domestic</option>
            <option value="imported">Imported</option>
          </select>
        </label>
        <div className="row">
          <Field label="ABV" value={draft.abv} onChange={(abv) => setDraft({ ...draft, abv })} />
          <Field label="Volume" value={draft.volume} onChange={(volume) => setDraft({ ...draft, volume })} />
          <Field label="Unit" value={draft.volumeUnit} onChange={(volumeUnit) => setDraft({ ...draft, volumeUnit })} />
        </div>
        <Field label="Label file name" value={draft.imageName} onChange={(imageName) => setDraft({ ...draft, imageName })} />
        <button type="submit">
          <Upload size={16} /> Submit
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <SubmissionList title="My Applications" records={records} onRefresh={refresh} />
    </section>
  );
}

function draftImage(value: string) {
  const trimmed = value.trim();
  const base = { id: crypto.randomUUID(), position: "front" };
  return /^https?:\/\//i.test(trimmed) ? { ...base, url: trimmed } : { ...base, localPath: trimmed };
}

function AdminView({ session }: { session: Session }) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [filter, setFilter] = useState<"all" | DecisionStatus>("all");
  const [error, setError] = useState<string>();
  const visibleRecords = useMemo(
    () => (filter === "all" ? records : records.filter((record) => record.submission.status === filter)),
    [filter, records]
  );

  async function refresh() {
    setRecords(await listAdminSubmissions(session));
  }

  async function apply(submissionId: string, status: DecisionStatus) {
    setError(undefined);
    try {
      await overrideSubmission(session, submissionId, status, `Admin override to ${status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Override failed");
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <div className="toolbar">
        <h2>Admin Queue</h2>
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="approved">Approved</option>
          <option value="needs_review">Needs review</option>
          <option value="rejected">Rejected</option>
        </select>
        <button type="button" onClick={refresh}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table">
        {visibleRecords.map((record) => (
          <article key={record.submission.id}>
            <strong>{record.submission.brandName}</strong>
            <span>{record.submission.productName}</span>
            <Status status={record.submission.status} />
            <span>{record.decision?.rationale ?? "No automated decision"}</span>
            <DecisionEvidence record={record} />
            <div className="actions">
              <button type="button" onClick={() => apply(record.submission.id, "approved")}>
                <Check size={16} /> Approve
              </button>
              <button type="button" onClick={() => apply(record.submission.id, "needs_review")}>
                <ShieldCheck size={16} /> Review
              </button>
              <button type="button" onClick={() => apply(record.submission.id, "rejected")}>
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SubmissionList({ title, records, onRefresh }: { title: string; records: SubmissionRecord[]; onRefresh: () => Promise<void> }) {
  return (
    <section>
      <div className="toolbar">
        <h2>{title}</h2>
        <button type="button" onClick={() => onRefresh()}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>
      <div className="table">
        {records.map((record) => (
          <article key={record.submission.id}>
            <strong>{record.submission.brandName}</strong>
            <span>{record.submission.productName}</span>
            <Status status={record.submission.status} />
            <span>{record.decision?.rationale ?? "Pending"}</span>
            <DecisionEvidence record={record} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Status({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status.replace("_", " ")}</span>;
}

function DecisionEvidence({ record }: { record: SubmissionRecord }) {
  if (!record.decision?.evidence?.length) return null;
  return (
    <details className="evidence">
      <summary>Decision evidence ({record.decision.evidence.length})</summary>
      <ul>
        {record.decision.evidence.map((item, index) => (
          <li key={`${item.field}-${index}`}>
            <strong>{item.field}</strong>
            <span className={`severity ${item.severity}`}>{item.severity}</span>
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
