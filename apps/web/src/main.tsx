import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  Eye,
  FileCheck2,
  FileImage,
  FileSearch,
  FileText,
  Gauge,
  ImagePlus,
  Inbox,
  Landmark,
  ListFilter,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserCircle,
  XCircle
} from "lucide-react";
import type { ApplicationStatus, ColaSubmission, DecisionStatus } from "@cola/shared";
import {
  createSubmission,
  getCurrentUser,
  listAdminSubmissions,
  listApplicantSubmissions,
  login,
  overrideSubmission,
  registerApplicant,
  type Session,
  type SubmissionRecord
} from "./api";
import "./tdds.css";
import "./styles.css";

const SESSION_STORAGE_KEY = "cola-auth-session";
type AuthMode = "login" | "register";
type StatusFilter = "all" | DecisionStatus;
type AppSection = "dashboard" | "form" | "evidence" | "records";
type WizardStep = "product" | "labels" | "review";
type ToastTone = "info" | "success" | "warning" | "error";

interface AppToast {
  id: string;
  tone: ToastTone;
  title: string;
  message: string;
}

interface UploadedLabelFile {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  previewUrl: string;
}

function App() {
  const [session, setSession] = useState<Session | undefined>(() => loadSession());
  const [authError, setAuthError] = useState<string>();
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const isAdmin = session?.roles.includes("admin") ?? false;

  useEffect(() => {
    if (!session) return;
    getCurrentUser(session)
      .then((user) => storeSession({ ...session, ...user }, setSession))
      .catch(() => {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setSession(undefined);
      });
  }, [session?.token]);

  function logout() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(undefined);
  }

  function navigate(section: AppSection) {
    setActiveSection(section);
    const targetId = sectionTargetId(section);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (!session) {
    return (
      <LoginView
        error={authError}
        onAuthenticated={(nextSession) => {
          setAuthError(undefined);
          storeSession(nextSession, setSession);
        }}
        onError={setAuthError}
      />
    );
  }

  return (
    <AppShell session={session} isAdmin={isAdmin} activeSection={activeSection} onNavigate={navigate} onLogout={logout}>
      {isAdmin ? <AdminView session={session} /> : <ApplicantView session={session} />}
    </AppShell>
  );
}

function LoginView({
  error,
  onAuthenticated,
  onError
}: {
  error: string | undefined;
  onAuthenticated: (session: Session) => void;
  onError: (message: string | undefined) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState(import.meta.env.DEV ? import.meta.env.VITE_APPLICANT_EMAIL ?? "" : "");
  const [password, setPassword] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    onError(undefined);
    try {
      const nextSession = mode === "login" ? await login(email, password) : await registerApplicant(email, password);
      onAuthenticated(nextSession);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Authentication failed");
    }
  }

  return (
    <div className="login-page cola-landing">
      <GovBanner />
      <main className="cola-login" id="main-content">
        <section className="login-hero" aria-label="COLA verification portal">
          <div className="login-hero__brand">
            <TreasuryMark size="large" />
            <div>
              <span className="login-hero__agency">U.S. Department of the Treasury</span>
              <h1>COLA Label Verification</h1>
            </div>
          </div>
          <p className="login-hero__copy">
            A secure workspace for applicants to submit alcohol label packages and for Treasury reviewers to inspect
            evidence before final decisions.
          </p>
          <div className="landing-workflow" aria-label="COLA workflow">
            <div>
              <Upload size={18} />
              <span>Submit label photos</span>
            </div>
            <div>
              <FileSearch size={18} />
              <span>Review evidence</span>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>Record decision</span>
            </div>
          </div>
        </section>

        <form className="login-card" onSubmit={submit}>
          <div className="login-card__banner login-card__banner--secure">
            <ShieldCheck size={16} />
            <span>TTB secure workspace</span>
          </div>
          <div className="login-card__header">
            <div className="login-card__agency">Alcohol and Tobacco Tax and Trade Bureau</div>
            <h2 className="login-card__title">{mode === "login" ? "Sign in to your workspace" : "Create applicant account"}</h2>
            <p className="login-card__subtitle">Access is separated for applicants and Treasury review staff.</p>
          </div>
          <div className="login-card__body">
            <div className="mode-switch" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={mode === "login" ? "mode-switch__item active" : "mode-switch__item"}
                onClick={() => setMode("login")}
              >
                <UserCircle size={16} /> Sign in
              </button>
              <button
                type="button"
                className={mode === "register" ? "mode-switch__item active" : "mode-switch__item"}
                onClick={() => setMode("register")}
              >
                <Send size={16} /> Sign up
              </button>
            </div>
            <Field label="Email address" value={email} onChange={setEmail} autoComplete="email" />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
            <button type="submit" className="usa-button usa-button--primary login-submit">
              {mode === "login" ? <ShieldCheck size={18} /> : <UserCircle size={18} />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
            {error && <Alert tone="error">{error}</Alert>}
          </div>
          <div className="login-card__footer">COLA applications, review records, and override actions are access controlled.</div>
        </form>
      </main>
    </div>
  );
}

function AppShell({
  children,
  session,
  isAdmin,
  activeSection,
  onNavigate,
  onLogout
}: {
  children: React.ReactNode;
  session: Session;
  isAdmin: boolean;
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
  onLogout: () => void;
}) {
  return (
    <div className="app-shell">
      <a className="usa-skipnav" href="#main-content">
        Skip to main content
      </a>
      <GovBanner />
      <SiteHeader session={session} isAdmin={isAdmin} onLogout={onLogout} />
      <div className="app-body">
        <SideNav isAdmin={isAdmin} email={session.email} activeSection={activeSection} onNavigate={onNavigate} />
        <main className="usa-main" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

function GovBanner() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="usa-banner" aria-label="Official government website">
      <div className="usa-banner__header">
        <div className="usa-banner__inner">
          <FlagMark />
          <p className="usa-banner__header-text">An official website of the United States government</p>
          <button
            type="button"
            className="usa-banner__button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="usa-banner__button-text">Here is how you know</span>
          </button>
        </div>
      </div>
      <div className="usa-banner__content" hidden={!expanded}>
        <div className="grid-row">
          <div className="usa-banner__guidance">
            <ShieldCheck className="usa-banner__icon" aria-hidden="true" />
            <div className="usa-media-block__body">
              <p>
                <strong>Official websites use .gov.</strong> Treasury digital services use managed domains and
                encrypted connections for public services.
              </p>
            </div>
          </div>
          <div className="usa-banner__guidance">
            <LockGlyph />
            <div className="usa-media-block__body">
              <p>
                <strong>Secure connections protect your information.</strong> Access is role based for applicant and
                admin workflows.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteHeader({ session, isAdmin, onLogout }: { session: Session; isAdmin: boolean; onLogout: () => void }) {
  return (
    <header className="usa-header">
      <div className="usa-header__title" aria-label="COLA Label Verification">
        <TreasuryMark />
        <div className="usa-header__branding">
          <span className="usa-header__agency">U.S. Department of the Treasury</span>
          <span className="usa-header__app-name">COLA Label Verification</span>
        </div>
      </div>
      <div className="usa-header__user">
        <span className="usa-header__user-name">{session.email}</span>
        <span className="usa-header__user-role">{isAdmin ? "Admin" : "Applicant"}</span>
        <button type="button" className="usa-header__logout" onClick={onLogout}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </header>
  );
}

function SideNav({
  isAdmin,
  email,
  activeSection,
  onNavigate
}: {
  isAdmin: boolean;
  email: string;
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
}) {
  const items: Array<{ section: AppSection; icon: React.ReactNode; label: string }> = isAdmin
    ? [
        { section: "dashboard", icon: <Gauge className="nav-icon" />, label: "Queue dashboard" },
        { section: "evidence", icon: <FileSearch className="nav-icon" />, label: "Decision evidence" },
        { section: "records", icon: <ClipboardCheck className="nav-icon" />, label: "Override log" }
      ]
    : [
        { section: "dashboard", icon: <Inbox className="nav-icon" />, label: "Application dashboard" },
        { section: "form", icon: <Upload className="nav-icon" />, label: "New submission" },
        { section: "records", icon: <FileText className="nav-icon" />, label: "Status history" }
      ];

  return (
    <aside className="usa-sidenav-container" aria-label="Primary navigation">
      <div className="sidenav-section">
        <div className="sidenav-section-label">{isAdmin ? "Review Operations" : "Applicant Portal"}</div>
        <ul className="usa-sidenav">
          {items.map((item) => (
            <li key={item.section}>
              <button
                type="button"
                className={activeSection === item.section ? "nav-btn active" : "nav-btn"}
                onClick={() => onNavigate(item.section)}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="sidenav-section">
        <div className="sidenav-section-label">Boundary</div>
        <div className="security-note">
          <ShieldCheck size={18} />
          <span>{isAdmin ? "Admin-only review controls" : "Applicant-only records"}</span>
        </div>
      </div>
      <div className="sidenav-footer">
        <strong>{email}</strong>
        <span>{isAdmin ? "Treasury review staff" : "Registered applicant"}</span>
      </div>
    </aside>
  );
}

function ApplicantView({ session }: { session: Session }) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [error, setError] = useState<string>();
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("product");
  const [selectedFiles, setSelectedFiles] = useState<UploadedLabelFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const knownStatusByIdRef = useRef(new Map<string, ApplicationStatus>());
  const hasLoadedRecordsRef = useRef(false);
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
    imageUrl: ""
  });
  const stats = useMemo(() => buildStats(records), [records]);
  const submissionImages = useMemo(() => buildSubmissionImages(selectedFiles, draft.imageUrl), [selectedFiles, draft.imageUrl]);

  function pushToast(toast: Omit<AppToast, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6500);
  }

  function rememberStatuses(nextRecords: SubmissionRecord[]) {
    knownStatusByIdRef.current = new Map(nextRecords.map((record) => [record.submission.id, record.submission.status]));
  }

  function announceChangedStatuses(nextRecords: SubmissionRecord[]) {
    if (!hasLoadedRecordsRef.current) {
      hasLoadedRecordsRef.current = true;
      rememberStatuses(nextRecords);
      return;
    }
    for (const record of nextRecords) {
      const previous = knownStatusByIdRef.current.get(record.submission.id);
      if (previous && previous !== record.submission.status) {
        pushToast(decisionToast(record));
      }
    }
    rememberStatuses(nextRecords);
  }

  async function refresh({ announceChanges = true } = {}) {
    const nextRecords = await listApplicantSubmissions(session);
    if (announceChanges) announceChangedStatuses(nextRecords);
    else rememberStatuses(nextRecords);
    setRecords(nextRecords);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [session.token]);

  async function submitApplication() {
    if (submitInFlightRef.current) return;
    setError(undefined);
    if (!submissionImages.length) {
      setError("Add at least one label photo or image URL before submitting.");
      setWizardStep("labels");
      return;
    }
    try {
      submitInFlightRef.current = true;
      setIsSubmitting(true);
      const { imageUrl: _imageUrl, ...submissionDraft } = draft;
      const created = await createSubmission(session, {
        ...submissionDraft,
        abv: Number(draft.abv) || undefined,
        volume: Number(draft.volume) || undefined,
        images: submissionImages
      });
      setSelectedFiles([]);
      setDraft((current) => ({ ...current, imageUrl: "" }));
      setWizardStep("product");
      pushToast({
        tone: "success",
        title: "Application submitted",
        message: `${created.submission.brandName} was received and reviewed by the automated pipeline.`
      });
      pushToast(decisionToast(created));
      await refresh({ announceChanges: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      setError(message);
      pushToast({ tone: "error", title: "Submission failed", message });
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function addFiles(files: FileList | File[]) {
    if (isSubmitting) return;
    const incoming = [...files].filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) {
      setError("Choose PNG, JPEG, or WebP label photos.");
      return;
    }
    const room = Math.max(0, 4 - selectedFiles.length);
    if (!room) {
      setError("Remove a label photo before adding another.");
      return;
    }
    try {
      const uploads = await Promise.all(incoming.slice(0, room).map(normalizeImageFile));
      setSelectedFiles((current) => [...current, ...uploads]);
      setError(undefined);
      setWizardStep("labels");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the selected image.");
    }
  }

  function nextStep() {
    setWizardStep((current) => (current === "product" ? "labels" : "review"));
  }

  function previousStep() {
    setWizardStep((current) => (current === "review" ? "labels" : "product"));
  }

  return (
    <div className="usa-page applicant-page" id="dashboard">
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      <PageHeader
        kicker="Applicant workspace"
        title="COLA Application Portal"
        subtitle="Submit label applications and track decisions attached to your own account."
        action={
          <button type="button" className="usa-button usa-button--outline" onClick={() => refresh()} disabled={isSubmitting}>
            <RefreshCcw size={16} /> Refresh
          </button>
        }
      />
      <StatsGrid stats={stats} />
      {error && <Alert tone="error">{error}</Alert>}

      <div className="portal-grid">
        <section className="usa-card submission-card" id="application-form" aria-busy={isSubmitting}>
          <div className="usa-card__header">
            <div>
              <span className="eyebrow">Guided COLA package</span>
              <h2 className="usa-card__header-title">Application wizard</h2>
            </div>
            <Upload size={20} className="card-icon" />
          </div>
          <div className="usa-card__body">
            <WizardStepper step={wizardStep} onSelect={setWizardStep} />
            {isSubmitting && <ProcessingCallout />}

            {wizardStep === "product" && (
              <div className="wizard-panel">
                <div className="form-grid">
                  <Field label="Brand" value={draft.brandName} onChange={(brandName) => setDraft({ ...draft, brandName })} />
                  <Field label="Product" value={draft.productName} onChange={(productName) => setDraft({ ...draft, productName })} />
                  <SelectField
                    label="Type"
                    value={draft.productType}
                    onChange={(productType) => setDraft({ ...draft, productType: productType as ColaSubmission["productType"] })}
                    options={[
                      ["distilled spirits", "Distilled spirits"],
                      ["malt beverage", "Malt beverage"],
                      ["wine", "Wine"]
                    ]}
                  />
                  <Field label="Class" value={draft.className} onChange={(className) => setDraft({ ...draft, className })} />
                  <Field label="Origin" value={draft.originName} onChange={(originName) => setDraft({ ...draft, originName })} />
                  <SelectField
                    label="Domestic or imported"
                    value={draft.domesticOrImported}
                    onChange={(domesticOrImported) =>
                      setDraft({ ...draft, domesticOrImported: domesticOrImported as ColaSubmission["domesticOrImported"] })
                    }
                    options={[
                      ["domestic", "Domestic"],
                      ["imported", "Imported"],
                      ["unknown", "Unknown"]
                    ]}
                  />
                  <Field label="ABV" value={draft.abv} onChange={(abv) => setDraft({ ...draft, abv })} inputMode="decimal" />
                  <Field label="Volume" value={draft.volume} onChange={(volume) => setDraft({ ...draft, volume })} inputMode="decimal" />
                  <Field label="Unit" value={draft.volumeUnit} onChange={(volumeUnit) => setDraft({ ...draft, volumeUnit })} />
                </div>
              </div>
            )}

            {wizardStep === "labels" && (
              <div className="wizard-panel">
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => {
                    if (event.currentTarget.files) void addFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                <div
                  className="upload-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void addFiles(event.dataTransfer.files);
                  }}
                >
                  <ImagePlus size={32} />
                  <strong>Drop label photos here</strong>
                  <span>PNG, JPEG, or WebP. Up to four label views.</span>
                  <button type="button" className="usa-button usa-button--outline" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
                    <Upload size={16} /> Upload from computer
                  </button>
                </div>

                <div className="upload-strip">
                  <FileCheck2 size={22} />
                  <Field
                    label="Image URL"
                    value={draft.imageUrl}
                    onChange={(imageUrl) => setDraft({ ...draft, imageUrl })}
                    placeholder="https://example.gov/label-front.jpg"
                  />
                </div>

                <UploadedFileList
                  files={selectedFiles}
                  onRemove={(id) => setSelectedFiles((current) => current.filter((file) => file.id !== id))}
                  disabled={isSubmitting}
                />
              </div>
            )}

            {wizardStep === "review" && (
              <div className="wizard-panel review-panel">
                <dl className="submission-summary">
                  <div>
                    <dt>Brand</dt>
                    <dd>{draft.brandName}</dd>
                  </div>
                  <div>
                    <dt>Product</dt>
                    <dd>{draft.productName}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{draft.productType}</dd>
                  </div>
                  <div>
                    <dt>Class</dt>
                    <dd>{draft.className}</dd>
                  </div>
                  <div>
                    <dt>Origin</dt>
                    <dd>{draft.originName}</dd>
                  </div>
                  <div>
                    <dt>Images</dt>
                    <dd>{submissionImages.length}</dd>
                  </div>
                </dl>
                <div className="review-files">
                  {selectedFiles.map((file) => (
                    <img key={file.id} src={file.previewUrl} alt={`${file.name} preview`} />
                  ))}
                  {draft.imageUrl.trim() && (
                    <div className="url-preview">
                      <FileImage size={20} />
                      <span>{draft.imageUrl.trim()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="usa-card__footer">
            <div className="wizard-actions">
              <button type="button" className="usa-button usa-button--secondary" onClick={previousStep} disabled={wizardStep === "product" || isSubmitting}>
                <ArrowLeft size={16} /> Back
              </button>
              {wizardStep !== "review" ? (
                <button type="button" className="usa-button usa-button--primary" onClick={nextStep} disabled={isSubmitting}>
                  Next <ArrowRight size={16} />
                </button>
              ) : (
                <button type="button" className="usa-button usa-button--primary" onClick={() => void submitApplication()} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 size={16} className="spin-icon" /> : <Upload size={16} />}
                  {isSubmitting ? "Processing application" : "Submit application"}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="usa-card record-card" id="records">
          <div className="usa-card__header">
            <div>
              <span className="eyebrow">Applicant record</span>
              <h2 className="usa-card__header-title">My applications</h2>
            </div>
            <span className="queue-count">{records.length}</span>
          </div>
          <SubmissionTable records={records} emptyLabel="No submitted applications yet." />
        </section>
      </div>
    </div>
  );
}

function WizardStepper({ step, onSelect }: { step: WizardStep; onSelect: (step: WizardStep) => void }) {
  const steps: Array<{ id: WizardStep; label: string; icon: React.ReactNode }> = [
    { id: "product", label: "Product", icon: <FileText size={15} /> },
    { id: "labels", label: "Labels", icon: <FileImage size={15} /> },
    { id: "review", label: "Review", icon: <Eye size={15} /> }
  ];
  const activeIndex = steps.findIndex((item) => item.id === step);

  return (
    <div className="wizard-stepper" role="tablist" aria-label="Submission steps">
      {steps.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={item.id === step ? "wizard-step active" : index < activeIndex ? "wizard-step complete" : "wizard-step"}
          onClick={() => onSelect(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function UploadedFileList({
  files,
  onRemove,
  disabled = false
}: {
  files: UploadedLabelFile[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (!files.length) {
    return (
      <div className="upload-empty">
        <FileImage size={18} />
        <span>No local label photos selected.</span>
      </div>
    );
  }

  return (
    <div className="uploaded-file-list">
      {files.map((file) => (
        <div className="uploaded-file" key={file.id}>
          <img src={file.previewUrl} alt={`${file.name} preview`} />
          <div>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)} after browser preparation</span>
          </div>
          <button type="button" className="icon-button" onClick={() => onRemove(file.id)} aria-label={`Remove ${file.name}`} disabled={disabled}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ProcessingCallout() {
  return (
    <div className="processing-callout" role="status" aria-live="polite">
      <Loader2 className="spin-icon" size={20} />
      <div>
        <strong>Processing application</strong>
        <span>Uploading label evidence and waiting for Claude review. This can take a few seconds.</span>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: AppToast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-label="Application notifications">
      {toasts.map((toast) => (
        <section className={`toast toast--${toast.tone}`} key={toast.id}>
          <div>
            <strong>{toast.title}</strong>
            <span>{toast.message}</span>
          </div>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            x
          </button>
        </section>
      ))}
    </div>
  );
}

function AdminView({ session }: { session: Session }) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [overrideReason, setOverrideReason] = useState("Reviewed by authorized Treasury admin.");
  const [error, setError] = useState<string>();
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [overridingId, setOverridingId] = useState<string>();
  const overrideInFlightRef = useRef(false);
  const stats = useMemo(() => buildStats(records), [records]);
  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesStatus = filter === "all" || record.submission.status === filter;
      if (!matchesStatus) return false;
      if (!needle) return true;
      return [
        record.submission.brandName,
        record.submission.productName,
        record.submission.applicantEmail,
        record.submission.className,
        record.decision?.rationale
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [filter, query, records]);

  async function refresh() {
    setRecords(await listAdminSubmissions(session));
  }

  function pushToast(toast: Omit<AppToast, "id">) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6500);
  }

  async function apply(submissionId: string, status: DecisionStatus) {
    if (overrideInFlightRef.current) return;
    setError(undefined);
    const reason = overrideReason.trim();
    if (!reason) {
      setError("Override reason is required.");
      return;
    }
    try {
      overrideInFlightRef.current = true;
      setOverridingId(submissionId);
      const updated = await overrideSubmission(session, submissionId, status, reason);
      pushToast(decisionToast(updated));
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Override failed";
      setError(message);
      pushToast({ tone: "error", title: "Override failed", message });
    } finally {
      overrideInFlightRef.current = false;
      setOverridingId(undefined);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [session.token]);

  return (
    <div className="usa-page admin-page" id="dashboard">
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      <PageHeader
        kicker="Admin review"
        title="COLA Decision Queue"
        subtitle="Review automated evidence, compare submitted fields, and record override decisions."
        action={
          <button type="button" className="usa-button usa-button--outline" onClick={() => refresh()}>
            <RefreshCcw size={16} /> Refresh
          </button>
        }
      />
      <StatsGrid stats={stats} />
      {error && <Alert tone="error">{error}</Alert>}

      <section className="usa-card admin-controls">
        <div className="usa-card__header">
          <div>
            <span className="eyebrow">Queue controls</span>
            <h2 className="usa-card__header-title">Filter and override context</h2>
          </div>
          <ListFilter size={20} className="card-icon" />
        </div>
        <div className="usa-card__body admin-control-grid">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              className="usa-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brand, applicant, or rationale"
            />
          </label>
          <SelectField
            label="Status"
            value={filter}
            onChange={(value) => setFilter(value as StatusFilter)}
            options={[
              ["all", "All decisions"],
              ["approved", "Approved"],
              ["needs_review", "Needs review"],
              ["rejected", "Rejected"]
            ]}
          />
          <div className="usa-form-group override-field">
            <label className="usa-label" htmlFor="override-reason">
              Override reason
            </label>
            <textarea
              id="override-reason"
              className="usa-textarea"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
          </div>
        </div>
      </section>

      <DecisionEvidenceOverview records={visibleRecords} />

      <section className="usa-card queue-card" id="records">
        <div className="usa-card__header">
          <div>
            <span className="eyebrow">Human-supervised decisions</span>
            <h2 className="usa-card__header-title">Applications awaiting final disposition</h2>
          </div>
          <span className="queue-count">{visibleRecords.length}</span>
        </div>
        <AdminQueue records={visibleRecords} onApply={apply} busySubmissionId={overridingId} />
      </section>
    </div>
  );
}

function PageHeader({
  kicker,
  title,
  subtitle,
  action
}: {
  kicker: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="usa-page-header">
      <div>
        <div className="usa-breadcrumb">{kicker}</div>
        <h1 className="usa-page-title">{title}</h1>
        <p className="usa-page-subtitle">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function StatsGrid({ stats }: { stats: ReturnType<typeof buildStats> }) {
  return (
    <section className="stat-grid" aria-label="Application summary">
      {stats.map((stat) => (
        <article className={`stat-card ${stat.tone}`} key={stat.label}>
          <div className="stat-label">{stat.label}</div>
          <div className={`stat-value ${stat.tone}`}>{stat.value}</div>
          <div className="stat-card__detail">{stat.detail}</div>
        </article>
      ))}
    </section>
  );
}

function SubmissionTable({ records, emptyLabel }: { records: SubmissionRecord[]; emptyLabel: string }) {
  if (!records.length) return <EmptyState label={emptyLabel} />;

  return (
    <div className="table-wrap">
      <table className="usa-table">
        <thead>
          <tr>
            <th scope="col">Application</th>
            <th scope="col">Status</th>
            <th scope="col">Submitted</th>
            <th scope="col">Automated rationale</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <React.Fragment key={record.submission.id}>
              <tr>
                <td>
                  <RecordTitle record={record} />
                </td>
                <td>
                  <Status status={record.submission.status} />
                </td>
                <td>{formatDate(record.submission.submittedAt)}</td>
                <td className="rationale-cell">
                  <span>{record.decision?.rationale ?? "Pending automated decision"}</span>
                </td>
                <td>
                  <EvidenceSummary record={record} />
                </td>
              </tr>
              <EvidenceRow record={record} columns={5} />
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminQueue({
  records,
  onApply,
  busySubmissionId
}: {
  records: SubmissionRecord[];
  onApply: (id: string, status: DecisionStatus) => void;
  busySubmissionId?: string;
}) {
  if (!records.length) return <EmptyState label="No applications match this queue." />;

  return (
    <div className="table-wrap">
      <table className="usa-table admin-table">
        <thead>
          <tr>
            <th scope="col">Submission</th>
            <th scope="col">Applicant</th>
            <th scope="col">Decision</th>
            <th scope="col">Confidence</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <React.Fragment key={record.submission.id}>
              <tr>
                <td>
                  <RecordTitle record={record} />
                </td>
                <td className="text-sm">{record.submission.applicantEmail}</td>
                <td>
                  <Status status={record.submission.status} />
                </td>
                <td>
                  <ConfidenceMeter value={record.decision?.confidence} />
                </td>
                <td>
                  <div className="decision-actions">
                    <button
                      type="button"
                      className="usa-button usa-button--success usa-button--sm"
                      onClick={() => onApply(record.submission.id, "approved")}
                      disabled={busySubmissionId === record.submission.id}
                    >
                      {busySubmissionId === record.submission.id ? <Loader2 size={14} className="spin-icon" /> : <Check size={14} />}
                      Approve
                    </button>
                    <button
                      type="button"
                      className="usa-button usa-button--secondary usa-button--sm"
                      onClick={() => onApply(record.submission.id, "needs_review")}
                      disabled={busySubmissionId === record.submission.id}
                    >
                      <ShieldCheck size={14} /> Review
                    </button>
                    <button
                      type="button"
                      className="usa-button usa-button--danger usa-button--sm"
                      onClick={() => onApply(record.submission.id, "rejected")}
                      disabled={busySubmissionId === record.submission.id}
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                </td>
              </tr>
              <tr className="rationale-row">
                <td colSpan={5}>{record.decision?.rationale ?? "No automated decision has been recorded."}</td>
              </tr>
              <EvidenceRow record={record} columns={5} />
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionEvidenceOverview({ records }: { records: SubmissionRecord[] }) {
  const signals = records
    .flatMap((record) =>
      (record.decision?.evidence ?? []).map((evidence) => ({
        ...evidence,
        submissionId: record.submission.id,
        brandName: record.submission.brandName,
        productName: record.submission.productName
      }))
    )
    .filter((item) => item.severity !== "info")
    .slice(0, 8);

  return (
    <section className="usa-card evidence-overview" id="decision-evidence">
      <div className="usa-card__header">
        <div>
          <span className="eyebrow">Decision evidence</span>
          <h2 className="usa-card__header-title">Review signals</h2>
        </div>
        <FileSearch size={20} className="card-icon" />
      </div>
      <div className="usa-card__body">
        {signals.length ? (
          <div className="signal-grid">
            {signals.map((signal, index) => (
              <article className="signal-item" key={`${signal.submissionId}-${signal.field}-${index}`}>
                <div>
                  <strong>{signal.brandName}</strong>
                  <span>{signal.productName}</span>
                </div>
                <span className={`severity severity--${signal.severity}`}>{signal.severity}</span>
                <p>
                  <b>{signal.field}</b>: {signal.message}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="signal-empty">
            <ShieldCheck size={22} />
            <span>No review or rejection signals in the current queue.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function EvidenceRow({ record, columns }: { record: SubmissionRecord; columns: number }) {
  const evidence = record.decision?.evidence ?? [];
  if (!evidence.length) return null;

  return (
    <tr className="evidence-row">
      <td colSpan={columns}>
        <details className="evidence-panel">
          <summary>Decision evidence ({evidence.length})</summary>
          <ul>
            {evidence.map((item, index) => (
              <li key={`${item.field}-${index}`}>
                <strong>{item.field}</strong>
                <span className={`severity severity--${item.severity}`}>{item.severity}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        </details>
      </td>
    </tr>
  );
}

function EvidenceSummary({ record }: { record: SubmissionRecord }) {
  const evidence = record.decision?.evidence ?? [];
  const reviewSignals = evidence.filter((item) => item.severity !== "info").length;
  if (!evidence.length) return <span className="text-muted text-sm">No evidence</span>;
  return (
    <span className="evidence-chip">
      <FileSearch size={14} />
      {reviewSignals || evidence.length} signal{(reviewSignals || evidence.length) === 1 ? "" : "s"}
    </span>
  );
}

function RecordTitle({ record }: { record: SubmissionRecord }) {
  return (
    <div className="record-title">
      <strong>{record.submission.brandName}</strong>
      <span>{record.submission.productName}</span>
      <small>{record.submission.className}</small>
    </div>
  );
}

function ConfidenceMeter({ value }: { value?: number }) {
  const percentage = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
  return (
    <div className="confidence-meter" aria-label={`Confidence ${percentage}%`}>
      <span className="confidence-meter__track">
        <span style={{ width: `${percentage}%` }} />
      </span>
      <strong>{value === undefined ? "Pending" : `${percentage}%`}</strong>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  inputMode,
  placeholder
}: {
  label: string;
  type?: React.HTMLInputTypeAttribute;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  const id = useMemo(() => `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2)}`, [label]);
  return (
    <div className="usa-form-group">
      <label className="usa-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="usa-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  const id = useMemo(() => `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, [label]);
  return (
    <div className="usa-form-group">
      <label className="usa-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="usa-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function Status({ status }: { status: ApplicationStatus | DecisionStatus | "admin" | "applicant" }) {
  return <span className={`usa-tag ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

function Alert({ tone, children }: { tone: "error" | "info" | "success" | "warning"; children: React.ReactNode }) {
  return <div className={`usa-alert usa-alert--${tone}`}>{children}</div>;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <FileText className="empty-state__icon" aria-hidden="true" />
      <h3>{label}</h3>
    </div>
  );
}

function TreasuryMark({ size = "default" }: { size?: "default" | "large" }) {
  return (
    <span className={size === "large" ? "treasury-mark treasury-mark--large" : "treasury-mark"} aria-hidden="true">
      <Landmark size={size === "large" ? 32 : 24} />
    </span>
  );
}

function FlagMark() {
  return (
    <span className="flag-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function LockGlyph() {
  return (
    <span className="lock-glyph" aria-hidden="true">
      <span />
    </span>
  );
}

function sectionTargetId(section: AppSection) {
  if (section === "form") return "application-form";
  if (section === "evidence") return "decision-evidence";
  if (section === "records") return "records";
  return "dashboard";
}

function buildSubmissionImages(files: UploadedLabelFile[], imageUrl: string) {
  const uploaded = files.map((file, index) => ({
    id: file.id,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    dataUrl: file.dataUrl,
    position: index === 0 ? "front" : `label-${index + 1}`
  }));
  const trimmedUrl = imageUrl.trim();
  if (!trimmedUrl) return uploaded;
  return [
    ...uploaded,
    {
      id: crypto.randomUUID(),
      url: trimmedUrl,
      filename: trimmedUrl.split("/").pop() || "remote-label",
      position: uploaded.length ? `label-${uploaded.length + 1}` : "front"
    }
  ];
}

async function normalizeImageFile(file: File): Promise<UploadedLabelFile> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files can be uploaded.");
  const sourceDataUrl = await readFileAsDataUrl(file);
  const preparedDataUrl = await resizeImageDataUrl(sourceDataUrl);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: estimatedDataUrlBytes(preparedDataUrl),
    type: "image/jpeg",
    dataUrl: preparedDataUrl,
    previewUrl: preparedDataUrl
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxEdge = 1400;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function estimatedDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.round((base64.length * 3) / 4);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function buildStats(records: SubmissionRecord[]) {
  return [
    { label: "Total", value: records.length, detail: "Applications in scope", tone: "" },
    { label: "Approved", value: countStatus(records, "approved"), detail: "Final or automated approval", tone: "success" },
    { label: "Needs review", value: countStatus(records, "needs_review"), detail: "Human attention required", tone: "warn" },
    { label: "Rejected", value: countStatus(records, "rejected"), detail: "Denied after review", tone: "danger" }
  ];
}

function countStatus(records: SubmissionRecord[], status: DecisionStatus) {
  return records.filter((record) => record.submission.status === status).length;
}

function decisionToast(record: SubmissionRecord): Omit<AppToast, "id"> {
  const status = record.decision?.status ?? record.submission.status;
  const label = statusLabel(status);
  switch (status) {
    case "approved":
      return {
        tone: "success",
        title: "Application approved",
        message: `${record.submission.brandName} was approved.`
      };
    case "needs_review":
      return {
        tone: "warning",
        title: "Application reviewed",
        message: `${record.submission.brandName} needs human review before final disposition.`
      };
    case "rejected":
      return {
        tone: "error",
        title: "Application denied",
        message: `${record.submission.brandName} was denied.`
      };
    case "submitted":
    case "processing":
      return {
        tone: "info",
        title: "Application submitted",
        message: `${record.submission.brandName} is ${label}.`
      };
    default:
      return {
        tone: "info",
        title: "Application updated",
        message: `${record.submission.brandName} status changed to ${label}.`
      };
  }
}

function statusClass(status: string) {
  switch (status) {
    case "approved":
      return "usa-tag--green";
    case "needs_review":
      return "usa-tag--yellow";
    case "rejected":
      return "usa-tag--red";
    case "processing":
    case "submitted":
      return "usa-tag--cyan";
    case "admin":
      return "usa-tag--blue";
    case "applicant":
      return "usa-tag--gray";
    default:
      return "usa-tag--gray";
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

createRoot(document.getElementById("root")!).render(<App />);

function loadSession(): Session | undefined {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.token || !parsed.email || !Array.isArray(parsed.roles)) return undefined;
    if (Date.parse(parsed.expiresAt) <= Date.now()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function storeSession(session: Session, setSession: (session: Session) => void) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  setSession(session);
}
