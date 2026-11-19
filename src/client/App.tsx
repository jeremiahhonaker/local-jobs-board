import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  CATEGORIES,
  api,
  categoryLabel,
  fmtDate,
  fmtMoney,
} from "./api";
import type { ContactInput, Me, PrivateJob, PublicJob } from "./api";

type Tab = "board" | "post" | "activity" | "earnings" | "safety";

const BOARD_FEE_NOTE =
  "The board keeps a 10% fee on each completed job. Fees are recorded here for now — actually collecting them needs a Stripe account, which is a later step. No real money moves in this version.";

export function App() {
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("board");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "invalid") {
      setNotice({
        kind: "error",
        text: "That sign-in link didn't work — it may have expired or already been used. Request a fresh one below.",
      });
      window.history.replaceState({}, "", "/");
    }
  }, []);

  function goTab(next: Tab) {
    setTab(next);
    setDetailId(null);
    setNotice(null);
  }

  async function signOut() {
    await api.logout().catch(() => null);
    setUser(null);
    goTab("board");
  }

  const needsAuth = tab === "post" || tab === "activity" || tab === "earnings";

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>Local Jobs Board</h1>
            <p className="tagline">Neighbors helping neighbors — small jobs, fair pay.</p>
          </div>
          {user ? (
            <div className="user-chip">
              <span>{user.email}</span>
              <button type="button" className="btn btn-ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            user === null && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setTab("board");
                  setDetailId("signin");
                }}
              >
                Sign in
              </button>
            )
          )}
        </div>
        <nav className="tabs" aria-label="Sections">
          {(
            [
              ["board", "Board"],
              ["post", "Post a Job"],
              ["activity", "My Activity"],
              ["earnings", "Earnings"],
              ["safety", "Safety"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value && detailId !== "signin" ? "tab active" : "tab"}
              onClick={() => goTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

        {detailId === "signin" ? (
          <SignInView
            onDone={() => {
              setDetailId(null);
              api
                .me()
                .then(({ user }) => setUser(user))
                .catch(() => null);
            }}
            onBack={() => setDetailId(null)}
          />
        ) : detailId ? (
          <JobDetailView
            jobId={detailId}
            user={user ?? null}
            onBack={() => setDetailId(null)}
            onChanged={refresh}
            onNeedSignIn={() => setDetailId("signin")}
            setNotice={setNotice}
          />
        ) : user === null && needsAuth ? (
          <AuthRequired onSignIn={() => setDetailId("signin")} />
        ) : tab === "board" ? (
          <BoardView refreshKey={refreshKey} onOpen={(id) => setDetailId(id)} onPost={() => goTab("post")} />
        ) : tab === "post" ? (
          <PostView
            user={user ?? null}
            onPosted={(id) => {
              refresh();
              setDetailId(id);
            }}
            setNotice={setNotice}
          />
        ) : tab === "activity" ? (
          <ActivityView refreshKey={refreshKey} onOpen={(id) => setDetailId(id)} onChanged={refresh} setNotice={setNotice} />
        ) : tab === "earnings" ? (
          <EarningsView user={user ?? null} refreshKey={refreshKey} />
        ) : (
          <SafetyView />
        )}
      </main>

      <footer className="footer">
        <p>
          Local Jobs Board · Postings show a neighborhood or town only — never a street address.
          Contact details are shared only between the poster and the worker who claims a job.
        </p>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ auth ---

function AuthRequired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="card center">
      <h2>Sign in to continue</h2>
      <p className="muted">
        You need an account to post jobs, claim work, and see your activity. Signing in takes
        about a minute — we email you a link, no password to remember.
      </p>
      <button type="button" className="btn btn-primary" onClick={onSignIn}>
        Sign in with email
      </button>
    </div>
  );
}

function SignInView({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.requestMagicLink(email);
      setSent(true);
      if (res.devLink) setDevLink(res.devLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back
      </button>
      <h2>Sign in</h2>
      {sent ? (
        <>
          <p>
            Check your email — we sent a sign-in link to <strong>{email}</strong>. It works
            once and expires in 15 minutes.
          </p>
          {devLink && (
            <p className="dev-note">
              Dev mode — sign in directly:{" "}
              <a href={devLink} onClick={onDone}>
                Open the sign-in link
              </a>
            </p>
          )}
          <p className="muted">Signed in on another tab? Press the button below to continue.</p>
          <button type="button" className="btn btn-primary" onClick={onDone}>
            I&apos;m signed in — continue
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="form">
          <label>
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
          <p className="muted small">
            No password to remember. The same link signs you up and signs you in.
          </p>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ board ---

function BoardView({
  refreshKey,
  onOpen,
  onPost,
}: {
  refreshKey: number;
  onOpen: (id: string) => void;
  onPost: () => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJobs(null);
    api
      .listJobs(category || undefined)
      .then(({ jobs }) => setJobs(jobs))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the board."));
  }, [category, refreshKey]);

  const totalPay = (jobs ?? []).reduce((t, j) => t + j.payCents, 0);

  return (
    <div>
      <section className="hero card">
        <div className="hero-stats">
          <div>
            <div className="hero-number">{jobs ? jobs.length : "—"}</div>
            <div className="hero-label">open jobs</div>
          </div>
          <div>
            <div className="hero-number">{jobs ? fmtMoney(totalPay) : "—"}</div>
            <div className="hero-label">pay on offer</div>
          </div>
        </div>
        <p className="muted">
          Every posting shows its pay up front. The board keeps a 10% fee on completed jobs —
          shown on every listing.
        </p>
      </section>

      <div className="filters" role="group" aria-label="Filter by category">
        <button
          type="button"
          className={category === "" ? "chip active" : "chip"}
          onClick={() => setCategory("")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={category === c.value ? "chip active" : "chip"}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="notice error">{error}</div>}
      {jobs === null && !error && <p className="muted">Loading the board…</p>}
      {jobs && jobs.length === 0 && (
        <div className="card center">
          <h2>No open jobs yet</h2>
          <p className="muted">
            The board starts empty on purpose — every listing here will be a real one a
            neighbor posted. Be the first.
          </p>
          <button type="button" className="btn btn-primary" onClick={onPost}>
            Post the first job
          </button>
        </div>
      )}
      <div className="job-list">
        {(jobs ?? []).map((job) => (
          <JobCard key={job.id} job={job} onOpen={() => onOpen(job.id)} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, onOpen }: { job: PublicJob; onOpen: () => void }) {
  return (
    <article className="job-card card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <div className="job-card-top">
        <span className="category-tag">{categoryLabel(job.category)}</span>
        <span className="job-area">{job.area}</span>
      </div>
      <h3>{job.title}</h3>
      {job.description && <p className="job-desc">{job.description}</p>}
      <div className="job-pay-row">
        <span className="pay-big">{fmtMoney(job.payCents)}</span>
        <span className="muted small">
          Worker gets {fmtMoney(job.workerCents)} · Board fee {fmtMoney(job.feeCents)}
        </span>
      </div>
      <div className="job-meta muted small">
        {job.dateNeeded ? <>Needed by {job.dateNeeded} · </> : null}
        Posted {fmtDate(job.createdAt)}
      </div>
    </article>
  );
}

// -------------------------------------------------------------- job detail ---

function JobDetailView({
  jobId,
  user,
  onBack,
  onChanged,
  onNeedSignIn,
  setNotice,
}: {
  jobId: string;
  user: Me | null;
  onBack: () => void;
  onChanged: () => void;
  onNeedSignIn: () => void;
  setNotice: (n: { kind: "error" | "info"; text: string } | null) => void;
}) {
  const [job, setJob] = useState<PublicJob | PrivateJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<ContactInput>({
    name: user?.name ?? "",
    phone: user?.phone ?? "",
    email: user?.email ?? "",
  });

  const load = useCallback(() => {
    api
      .getJob(jobId)
      .then(({ job }) => setJob(job))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this job."));
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="notice error">{error}</div>;
  if (!job) return <p className="muted">Loading…</p>;

  const isPrivate = "isPoster" in job;
  const isPoster = isPrivate && job.isPoster;
  const isClaimer = isPrivate && job.isClaimer;
  const canClaim = user && !isPoster && job.status === "open";

  async function run(action: () => Promise<unknown>, doneText: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "info", text: doneText });
      load();
      onChanged();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiError ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Back to the board
      </button>
      <div className="job-card-top">
        <span className="category-tag">{categoryLabel(job.category)}</span>
        <span className="job-area">{job.area}</span>
        <span className={`status status-${job.status}`}>{job.status}</span>
      </div>
      <h2>{job.title}</h2>
      {job.description && <p>{job.description}</p>}
      <div className="job-pay-row">
        <span className="pay-big">{fmtMoney(job.payCents)}</span>
        <span className="muted small">
          Worker gets {fmtMoney(job.workerCents)} · Board fee {fmtMoney(job.feeCents)}
        </span>
      </div>
      <p className="muted small">
        {job.dateNeeded ? <>Needed by {job.dateNeeded} · </> : null}
        Posted {fmtDate(job.createdAt)}
        {job.completedAt ? <> · Completed {fmtDate(job.completedAt)}</> : null}
      </p>

      {isPrivate && (isPoster || isClaimer) && (
        <section className="contact-box">
          <h3>Contact details</h3>
          <p className="muted small">
            Shared only between you and the other side of this job.
          </p>
          <dl>
            <dt>Poster</dt>
            <dd>
              {job.posterName}
              {job.posterPhone ? <> · {job.posterPhone}</> : null}
              {job.posterEmail ? <> · {job.posterEmail}</> : null}
            </dd>
            {job.claimerName && (
              <>
                <dt>Worker</dt>
                <dd>
                  {job.claimerName}
                  {job.claimerPhone ? <> · {job.claimerPhone}</> : null}
                  {job.claimerEmail ? <> · {job.claimerEmail}</> : null}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {!user && job.status === "open" && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onNeedSignIn}>
            Sign in to claim this job
          </button>
        </div>
      )}

      {canClaim && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.claimJob(job.id, claim), "Job claimed — contact details are now shared with the poster.");
          }}
        >
          <h3>Claim this job</h3>
          <p className="muted small">
            Your contact details go only to the person who posted this job.
          </p>
          <label>
            Your name
            <input
              required
              value={claim.name}
              onChange={(e) => setClaim({ ...claim, name: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              value={claim.phone ?? ""}
              onChange={(e) => setClaim({ ...claim, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={claim.email ?? ""}
              onChange={(e) => setClaim({ ...claim, email: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Claiming…" : `Claim this job — earn ${fmtMoney(job.workerCents)}`}
          </button>
        </form>
      )}

      {isPoster && job.status === "open" && (
        <div className="actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run(() => api.cancelJob(job.id), "Job cancelled.")}
          >
            Cancel this job
          </button>
        </div>
      )}

      {job.status === "claimed" && (isPoster || isClaimer) && (
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(() => api.completeJob(job.id), "Job marked done — the 10% fee was recorded.")
            }
          >
            Mark job done
          </button>
          {isClaimer && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => run(() => api.unclaimJob(job.id), "Job released back to the board.")}
            >
              Release this job
            </button>
          )}
          {isPoster && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => api.cancelJob(job.id), "Job cancelled.")}
            >
              Cancel this job
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- post ---

function PostView({
  user,
  onPosted,
  setNotice,
}: {
  user: Me | null;
  onPosted: (id: string) => void;
  setNotice: (n: { kind: "error" | "info"; text: string } | null) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    category: "yard-work",
    description: "",
    pay: "",
    area: "",
    dateNeeded: "",
    contactName: user?.name ?? "",
    contactPhone: user?.phone ?? "",
    contactEmail: user?.email ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payNum = Number(form.pay);
  const payCents = Number.isFinite(payNum) && payNum > 0 ? Math.round(payNum * 100) : 0;
  const feeCents = Math.round(payCents * 0.1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { job } = await api.createJob({
        title: form.title,
        category: form.category,
        description: form.description,
        pay: payNum,
        area: form.area,
        dateNeeded: form.dateNeeded || null,
        contact: {
          name: form.contactName,
          phone: form.contactPhone,
          email: form.contactEmail,
        },
      });
      setNotice({ kind: "info", text: "Your job is live on the board." });
      onPosted(job.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post the job. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card">
      <h2>Post a job</h2>
      <p className="muted">
        Describe the work, name your price, and say roughly where it is. Your exact address
        stays private — share it only with the worker who claims the job.
      </p>
      <form onSubmit={submit} className="form">
        <label>
          Job title
          <input
            required
            minLength={3}
            maxLength={120}
            value={form.title}
            onChange={set("title")}
            placeholder="Mow my lawn, about an acre"
          />
        </label>
        <label>
          Category
          <select value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Details
          <textarea
            rows={4}
            maxLength={2000}
            value={form.description}
            onChange={set("description")}
            placeholder="What needs doing, how big the job is, anything the worker should bring…"
          />
        </label>
        <div className="form-row">
          <label>
            Pay ($)
            <input
              required
              type="number"
              min={1}
              max={10000}
              step="1"
              inputMode="numeric"
              value={form.pay}
              onChange={set("pay")}
              placeholder="60"
            />
          </label>
          <label>
            Date needed (optional)
            <input type="date" value={form.dateNeeded} onChange={set("dateNeeded")} />
          </label>
        </div>
        {payCents > 0 && (
          <p className="fee-preview">
            Worker gets <strong>{fmtMoney(payCents - feeCents)}</strong> · Board fee (10%){" "}
            <strong>{fmtMoney(feeCents)}</strong>
          </p>
        )}
        <label>
          Area — neighborhood or town (never your street address)
          <input
            required
            maxLength={100}
            value={form.area}
            onChange={set("area")}
            placeholder="Willisburg, near Sportsman Lane"
          />
        </label>
        <fieldset>
          <legend>How the worker reaches you (shared only with the claimer)</legend>
          <label>
            Your name
            <input required maxLength={100} value={form.contactName} onChange={set("contactName")} />
          </label>
          <label>
            Phone
            <input value={form.contactPhone} onChange={set("contactPhone")} placeholder="(555) 123-4567" />
          </label>
          <label>
            Email
            <input type="email" value={form.contactEmail} onChange={set("contactEmail")} />
          </label>
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Posting…" : "Post this job"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- activity ---

function ActivityView({
  refreshKey,
  onOpen,
  onChanged,
  setNotice,
}: {
  refreshKey: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
  setNotice: (n: { kind: "error" | "info"; text: string } | null) => void;
}) {
  const [data, setData] = useState<{ posted: PrivateJob[]; claimed: PrivateJob[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .activity()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your activity."));
  }, [refreshKey]);

  if (error) return <div className="notice error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const Section = ({ title, jobs, empty }: { title: string; jobs: PrivateJob[]; empty: string }) => (
    <section>
      <h2>{title}</h2>
      {jobs.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="job-list">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onOpen={() => onOpen(job.id)} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div>
      <Section title="Jobs you posted" jobs={data.posted} empty="You haven't posted a job yet." />
      <Section title="Jobs you claimed" jobs={data.claimed} empty="You haven't claimed a job yet. Check the board." />
      <p className="muted small">
        Tap a job to see contact details and mark it done, release it, or cancel it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- earnings ---

function EarningsView({ user, refreshKey }: { user: Me | null; refreshKey: number }) {
  const [mine, setMine] = useState<import("./api").MyEarnings | null>(null);
  const [board, setBoard] = useState<import("./api").OwnerEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myEarnings()
      .then(setMine)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load earnings."));
    if (user?.isOwner) {
      api
        .ownerEarnings()
        .then(setBoard)
        .catch(() => null);
    }
  }, [refreshKey, user?.isOwner]);

  if (error) return <div className="notice error">{error}</div>;
  if (!mine) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="card">
        <h2>Your earnings</h2>
        <div className="hero-stats">
          <div>
            <div className="hero-number">{fmtMoney(mine.asWorker.totalPayCents - mine.asWorker.totalFeeCents)}</div>
            <div className="hero-label">earned as a worker ({mine.asWorker.jobsCompleted} jobs)</div>
          </div>
          <div>
            <div className="hero-number">{fmtMoney(mine.asPoster.totalSpentCents)}</div>
            <div className="hero-label">spent as a poster ({mine.asPoster.jobsCompleted} jobs done)</div>
          </div>
        </div>
        <p className="muted small">
          Worker earnings are shown after the board's 10% fee (
          {fmtMoney(mine.asWorker.totalFeeCents)} in fees on your completed jobs).
        </p>
      </div>

      {user?.isOwner && board && (
        <div className="card">
          <h2>Board earnings</h2>
          <div className="hero-stats">
            <div>
              <div className="hero-number">{fmtMoney(board.totalFeeCents)}</div>
              <div className="hero-label">fees recorded ({board.jobsCompleted} jobs done)</div>
            </div>
            <div>
              <div className="hero-number">{fmtMoney(board.totalPayCents)}</div>
              <div className="hero-label">total pay through the board</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>About fees</h3>
        <p className="muted">{BOARD_FEE_NOTE}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ safety ---

function SafetyView() {
  return (
    <div className="card">
      <h2>Stay safe</h2>
      <p className="muted">
        This board is neighbors helping neighbors. A few rules keep it that way:
      </p>
      <ul className="safety-list">
        <li>Meet in a public place first when you can — or let someone know where you&apos;re going and when you&apos;ll be back.</li>
        <li>Share your exact address only with the person doing your job — never in a listing. Listings show a neighborhood or town only.</li>
        <li>Agree on the pay and what&apos;s included before work starts. The pay on the listing is the deal.</li>
        <li>Pay when the work is done and you&apos;re happy with it.</li>
        <li>Trust your gut. If something feels off, cancel the job and walk away — no explanation owed.</li>
        <li>Keep your contact details between you and the other side of the job. They&apos;re never shown on the public board.</li>
        <li>
          The board never asks for ID, bank details, or your Social Security number. Anyone
          asking for those is a scam.
        </li>
      </ul>
    </div>
  );
}
