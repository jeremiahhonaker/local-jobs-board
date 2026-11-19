/**
 * End-to-end test for the Local Jobs Board standalone app.
 *
 * Run against a locally running server with a fresh database:
 *
 *   rm -f data/test.db*
 *   DEV_AUTH_DEBUG=1 OWNER_EMAIL=owner@test.local LOCAL_DB_PATH=./data/test.db \
 *     bun run src/server/index.ts &
 *   bun run test:e2e
 *
 * Requires DEV_AUTH_DEBUG=1 on the server (magic links are returned in the
 * API response in dev mode so sign-in works without email).
 *
 * Checks: sign up, post, claim as a second user, complete, 10% fee math,
 * Earnings totals, and that users cannot see or change each other's data.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

interface Session {
  email: string;
  cookie: string;
}

async function req(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; redirect?: RequestRedirect } = {},
): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    redirect: opts.redirect ?? "follow",
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json, headers: res.headers };
}

/** Signs a user in via the dev magic link and returns their session cookie. */
async function signIn(email: string): Promise<Session> {
  const magic = await req("/api/auth/magic-link", { method: "POST", body: { email } });
  if (magic.status !== 200 || !magic.json?.devLink) {
    throw new Error(`magic link failed for ${email}: ${magic.status} ${JSON.stringify(magic.json)}`);
  }
  const token = new URL(magic.json.devLink).searchParams.get("token");
  if (!token) throw new Error("devLink had no token");
  const verify = await req(`/auth/verify?token=${token}`, { redirect: "manual" });
  const setCookie = verify.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/ljb_session=([^;]+)/);
  if (!match) throw new Error(`no session cookie for ${email} (status ${verify.status})`);
  return { email, cookie: `ljb_session=${match[1]}` };
}

async function main() {
  section("1. Health + public board (unauthenticated)");
  const health = await req("/health");
  check("GET /health returns 200", health.status === 200 && health.json?.ok === true);

  const home = await fetch(`${BASE}/`);
  const homeHtml = await home.text();
  check("GET / serves the client", home.status === 200 && homeHtml.includes('<div id="root">'));

  const anonPost = await req("/api/jobs", { method: "POST", body: { title: "x" } });
  check("Unauthenticated POST /api/jobs is rejected (401)", anonPost.status === 401);

  section("2. Sign up Alice (poster) and post two jobs");
  const alice = await signIn("alice@test.local");
  const meAlice = await req("/api/me", { cookie: alice.cookie });
  check("Alice /api/me returns her email", meAlice.json?.user?.email === "alice@test.local");

  const job1 = await req("/api/jobs", {
    method: "POST",
    cookie: alice.cookie,
    body: {
      title: "Mow my lawn, about an acre",
      category: "yard-work",
      description: "Front and back, bag the clippings.",
      pay: 60,
      area: "Willisburg",
      dateNeeded: "2026-11-25",
      contact: { name: "Alice", phone: "555-0101", email: "alice@test.local" },
    },
  });
  check("Alice posts job 1 ($60)", job1.status === 201, job1.json);
  const job1Id: string = job1.json.job.id;
  check("Job 1 fee preview is 10% ($6.00 = 600 cents)", job1.json.job.feeCents === 600);
  check("Job 1 worker share is $54.00", job1.json.job.workerCents === 5400);

  const job2 = await req("/api/jobs", {
    method: "POST",
    cookie: alice.cookie,
    body: {
      title: "Help moving a couch",
      category: "moving-help",
      description: "One couch, two flights of stairs.",
      pay: 45,
      area: "Springfield",
      contact: { name: "Alice", phone: "555-0101", email: "alice@test.local" },
    },
  });
  check("Alice posts job 2 ($45)", job2.status === 201, job2.json);
  const job2Id: string = job2.json.job.id;

  const board = await req("/api/jobs");
  check("Public board lists 2 open jobs", board.json?.jobs?.length === 2, board.json);
  const publicKeys = Object.keys(board.json.jobs[0] ?? {});
  check("Public board hides contact details", !publicKeys.some((k) => /poster|claimer|email|phone/i.test(k)), publicKeys);
  check("Public board shows the fee on every posting", board.json.jobs.every((j: any) => typeof j.feeCents === "number"));

  section("3. Alice cannot claim her own job; Bob signs up and claims job 1");
  const selfClaim = await req(`/api/jobs/${job1Id}/claim`, {
    method: "POST",
    cookie: alice.cookie,
    body: { contact: { name: "Alice", phone: "555-0101" } },
  });
  check("Alice claiming her own job is rejected (403)", selfClaim.status === 403, selfClaim.json);

  const bob = await signIn("bob@test.local");
  const claim = await req(`/api/jobs/${job1Id}/claim`, {
    method: "POST",
    cookie: bob.cookie,
    body: { contact: { name: "Bob", phone: "555-0202", email: "bob@test.local" } },
  });
  check("Bob claims job 1", claim.status === 200 && claim.json.job.status === "claimed", claim.json);
  check("Claimer (Bob) sees the poster's contact", claim.json.job.posterPhone === "555-0101");

  const aliceView = await req(`/api/jobs/${job1Id}`, { cookie: alice.cookie });
  check("Poster (Alice) sees the claimer's contact", aliceView.json.job.claimerPhone === "555-0202");

  section("4. A third user sees no contact details and cannot act on the job");
  const carol = await signIn("carol@test.local");
  const carolView = await req(`/api/jobs/${job1Id}`, { cookie: carol.cookie });
  const carolKeys = Object.keys(carolView.json.job ?? {});
  check(
    "Carol (not a party) sees no contact details",
    !carolKeys.some((k) => /poster|claimer/i.test(k)),
    carolKeys,
  );
  const carolComplete = await req(`/api/jobs/${job1Id}/complete`, { method: "POST", cookie: carol.cookie });
  check("Carol completing the job is rejected (403)", carolComplete.status === 403);
  const bobCancel = await req(`/api/jobs/${job1Id}/cancel`, { method: "POST", cookie: bob.cookie });
  check("Bob (not poster) cancelling is rejected (403)", bobCancel.status === 403);
  const carolClaim = await req(`/api/jobs/${job1Id}/claim`, {
    method: "POST",
    cookie: carol.cookie,
    body: { contact: { name: "Carol" } },
  });
  check("Claiming an already-claimed job is rejected (409)", carolClaim.status === 409);

  section("5. Complete both jobs — fee math");
  const complete1 = await req(`/api/jobs/${job1Id}/complete`, { method: "POST", cookie: bob.cookie });
  check(
    "Bob (worker) completes job 1, fee recorded $6.00",
    complete1.status === 200 && complete1.json.job.feeCents === 600 && complete1.json.job.status === "completed",
    complete1.json,
  );

  const claim2 = await req(`/api/jobs/${job2Id}/claim`, {
    method: "POST",
    cookie: bob.cookie,
    body: { contact: { name: "Bob", phone: "555-0202", email: "bob@test.local" } },
  });
  check("Bob claims job 2", claim2.status === 200);
  const complete2 = await req(`/api/jobs/${job2Id}/complete`, { method: "POST", cookie: alice.cookie });
  check(
    "Alice (poster) completes job 2, fee recorded $4.50",
    complete2.status === 200 && complete2.json.job.feeCents === 450,
    complete2.json,
  );

  const doubleComplete = await req(`/api/jobs/${job2Id}/complete`, { method: "POST", cookie: alice.cookie });
  check("Completing an already-completed job is rejected (409)", doubleComplete.status === 409);

  section("6. Earnings totals");
  const bobEarnings = await req("/api/my/earnings", { cookie: bob.cookie });
  check("Bob earned 2 jobs as worker", bobEarnings.json?.asWorker?.jobsCompleted === 2, bobEarnings.json);
  check("Bob total pay $105.00", bobEarnings.json?.asWorker?.totalPayCents === 10500);
  check("Bob total fees $10.50", bobEarnings.json?.asWorker?.totalFeeCents === 1050);
  const aliceEarnings = await req("/api/my/earnings", { cookie: alice.cookie });
  check("Alice spent $105.00 as poster", aliceEarnings.json?.asPoster?.totalSpentCents === 10500);
  check("Alice completed 2 jobs as poster", aliceEarnings.json?.asPoster?.jobsCompleted === 2);

  const owner = await signIn("owner@test.local");
  const ownerEarnings = await req("/api/owner/earnings", { cookie: owner.cookie });
  check("Owner sees board total fees $10.50", ownerEarnings.json?.totalFeeCents === 1050, ownerEarnings.json);
  check("Owner sees 2 completed jobs", ownerEarnings.json?.jobsCompleted === 2);
  const bobOwnerAttempt = await req("/api/owner/earnings", { cookie: bob.cookie });
  check("Non-owner cannot see board totals (403)", bobOwnerAttempt.status === 403);

  section("7. Activity, unclaim, cancel");
  const bobActivity = await req("/api/my/activity", { cookie: bob.cookie });
  check("Bob activity shows 2 claimed jobs", bobActivity.json?.claimed?.length === 2);
  check("Bob activity shows 0 posted jobs", bobActivity.json?.posted?.length === 0);
  const aliceActivity = await req("/api/my/activity", { cookie: alice.cookie });
  check("Alice activity shows 2 posted jobs", aliceActivity.json?.posted?.length === 2);

  const job3 = await req("/api/jobs", {
    method: "POST",
    cookie: alice.cookie,
    body: {
      title: "Clean my gutters",
      category: "cleaning",
      pay: 80,
      area: "Willisburg",
      contact: { name: "Alice", phone: "555-0101" },
    },
  });
  const job3Id: string = job3.json.job.id;
  await req(`/api/jobs/${job3Id}/claim`, {
    method: "POST",
    cookie: bob.cookie,
    body: { contact: { name: "Bob", phone: "555-0202" } },
  });
  const unclaim = await req(`/api/jobs/${job3Id}/unclaim`, { method: "POST", cookie: bob.cookie });
  check("Bob releases job 3 back to open", unclaim.status === 200 && unclaim.json.job.status === "open");
  const boardAfter = await req("/api/jobs");
  check("Released job 3 is open on the board again", boardAfter.json.jobs.some((j: any) => j.id === job3Id));

  const cancel = await req(`/api/jobs/${job3Id}/cancel`, { method: "POST", cookie: alice.cookie });
  check("Alice cancels job 3", cancel.status === 200 && cancel.json.job.status === "cancelled");
  const claimCancelled = await req(`/api/jobs/${job3Id}/claim`, {
    method: "POST",
    cookie: bob.cookie,
    body: { contact: { name: "Bob" } },
  });
  check("Claiming a cancelled job is rejected (409)", claimCancelled.status === 409);

  const badJob = await req("/api/jobs", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "x", category: "nope", pay: 0, area: "", contact: { name: "" } },
  });
  check("Invalid job post is rejected (400)", badJob.status === 400);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E test crashed:", err);
  process.exit(1);
});
