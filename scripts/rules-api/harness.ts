import { execFileSync } from "node:child_process";

/**
 * A small client for the Firebase Rules API `:test` endpoint, which evaluates
 * a ruleset server-side against made-up requests. It deploys nothing and
 * reads or writes no data: every document a rule looks at is a mock, given
 * per case in `world` (before the write) and `after` (as the batch leaves it).
 *
 * This is the local half of the rules' tests. `src/cloud/rules.test.ts` runs
 * the app's own cloud modules against the real emulator, in CI, because it
 * needs Java; this needs only `gcloud` logged in as somebody who may test
 * rules on the project, and answers in seconds. What it cannot see is
 * anything that spans a request — a batch's access-call budget, the
 * per-request document cache — which is what the emulator suite is for.
 */

export type Expectation = "ALLOW" | "DENY";
export type Method = "get" | "list" | "create" | "update" | "delete";
export type Data = { [key: string]: unknown };
/** Documents by path under `/databases/(default)/documents/`; `null` = absent. */
export type World = { [path: string]: Data | null };

export interface Auth {
  uid: string;
  token: Data;
}

export interface Row {
  id: string;
  what: string;
  /** What these rules must answer. */
  expect: Expectation;
  /**
   * What the rules before the hardening answered, when it was different —
   * the hole, for an attack. Checked by `--before <rules file>`.
   */
  was?: Expectation;
  who: Auth | null;
  method: Method;
  path: string;
  /** The document as the write would leave it (`request.resource.data`). */
  data?: Data;
  /** The document as it is now (`resource.data`). */
  existing?: Data;
  world?: World;
  after?: World;
}

export const DOCS = "/databases/(default)/documents";
/** `request.time`. RFC 3339 strings in mock data are read as timestamps by the API. */
export const TIME = "2026-10-16T12:00:00Z";

export function google(uid: string, email: string, verified = true, provider = "google.com"): Auth {
  return {
    uid,
    token: { email, email_verified: verified, firebase: { sign_in_provider: provider } },
  };
}

export function anon(uid: string): Auth {
  return { uid, token: { firebase: { sign_in_provider: "anonymous" } } };
}

interface Mock {
  function: string;
  args: { exactValue: string }[];
  result: { value: unknown };
}

function mocks(world: World, after: World): Mock[] {
  const out: Mock[] = [];
  const paths = new Set([...Object.keys(world), ...Object.keys(after)]);
  for (const path of [...paths].sort()) {
    const full = `${DOCS}/${path}`;
    const before = path in world ? world[path] : null;
    const later = path in after ? after[path] : before;
    const doc = (d: Data | null) => (d === null ? null : { data: d });
    out.push({ function: "get", args: [{ exactValue: full }], result: { value: doc(before) } });
    out.push({ function: "exists", args: [{ exactValue: full }], result: { value: before !== null } });
    out.push({ function: "getAfter", args: [{ exactValue: full }], result: { value: doc(later) } });
    out.push({ function: "existsAfter", args: [{ exactValue: full }], result: { value: later !== null } });
  }
  return out;
}

export interface TestCase {
  expectation: Expectation;
  request: Data;
  resource?: { data: Data };
  functionMocks?: Mock[];
}

export function testCase(row: Row, expectation: Expectation): TestCase {
  const request: Data = { path: `${DOCS}/${row.path}`, method: row.method, time: TIME };
  if (row.who !== null) request.auth = row.who;
  if (row.data !== undefined) request.resource = { data: row.data };
  const out: TestCase = { expectation, request };
  if (row.existing !== undefined) out.resource = { data: row.existing };
  const m = mocks(row.world ?? {}, row.after ?? {});
  if (m.length > 0) out.functionMocks = m;
  return out;
}

export interface TestResult {
  state?: string;
  debugMessages?: string[];
  errorPosition?: unknown;
  functionCalls?: { function?: string; args?: unknown[] }[];
}

function accessToken(): string {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

/** Every case through `:test`, in chunks the endpoint is happy with. */
export async function runCases(
  project: string,
  rules: string,
  cases: TestCase[],
  chunk = 12,
): Promise<TestResult[]> {
  const token = accessToken();
  const results: TestResult[] = [];
  for (let i = 0; i < cases.length; i += chunk) {
    const body = {
      source: { files: [{ name: "firestore.rules", content: rules }] },
      testSuite: { testCases: cases.slice(i, i + chunk) },
    };
    const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-goog-user-project": project,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 3000)}`);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error(`unexpected: ${text.slice(0, 3000)}`);
    const issues = (parsed as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      throw new Error(`the rules do not compile: ${JSON.stringify(issues).slice(0, 3000)}`);
    }
    const batch = (parsed as { testResults?: unknown }).testResults;
    if (!Array.isArray(batch) || batch.length !== Math.min(chunk, cases.length - i)) {
      throw new Error(`unexpected: ${text.slice(0, 3000)}`);
    }
    results.push(...(batch as TestResult[]));
  }
  return results;
}
