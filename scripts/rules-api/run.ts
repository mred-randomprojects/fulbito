import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROWS } from "./cases.ts";
import { DOCS, runCases, testCase, type Row, type TestResult } from "./harness.ts";

/**
 * `firestore.rules` through the Firebase Rules API, every case in `cases.ts`.
 *
 *   npm run test:rules:api                         # the rules in this checkout
 *   npm run test:rules:api -- --before old.rules   # another file, against `was`
 *   npm run test:rules:api -- --only A-K           # rows whose id starts so
 *
 * Needs `gcloud auth login` as an account that may run rules tests on the
 * project (`firebaserules.rulesets.test`). Deploys nothing and touches no data.
 * Exits non-zero on any case that answers otherwise than expected, and on any
 * case whose rules looked at a document its world does not describe.
 */

const PROJECT = process.env.RULES_PROJECT ?? "fulbito-84cb3";

function argument(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

/** Paths the rules asked about that the case never mocked. */
function unmocked(row: Row, result: TestResult): string[] {
  const known = new Set([...Object.keys(row.world ?? {}), ...Object.keys(row.after ?? {})]);
  const out: string[] = [];
  for (const call of result.functionCalls ?? []) {
    for (const arg of call.args ?? []) {
      if (typeof arg !== "string") continue;
      const path = decodeURIComponent(arg);
      if (!path.startsWith(`${DOCS}/`)) continue;
      const rel = path.slice(DOCS.length + 1);
      if (!known.has(rel)) out.push(`${call.function ?? "?"}(${rel})`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const before = argument("--before");
  const only = argument("--only");
  const rulesPath = before ?? fileURLToPath(new URL("../../firestore.rules", import.meta.url));
  const rules = readFileSync(rulesPath, "utf8");
  const rows = ROWS.filter((row) => only === null || row.id.startsWith(only));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`two rows called ${row.id}`);
    seen.add(row.id);
  }

  const expected = (row: Row) => (before === null ? row.expect : (row.was ?? row.expect));
  const results = await runCases(
    PROJECT,
    rules,
    rows.map((row) => testCase(row, expected(row))),
  );

  let bad = 0;
  let allows = 0;
  for (const [i, row] of rows.entries()) {
    const result = results[i];
    const missing = unmocked(row, result);
    const ok = result.state === "SUCCESS" && missing.length === 0;
    if (!ok) bad += 1;
    if (expected(row) === "ALLOW") allows += 1;
    const note = ok
      ? ""
      : `  <- ${result.state ?? "?"} ${missing.length > 0 ? `unmocked: ${missing.join(", ")} ` : ""}${JSON.stringify(result.debugMessages ?? []).slice(0, 300)}`;
    console.log(`${row.id.padEnd(7)} ${expected(row).padEnd(5)} ${ok ? "ok      " : "MISMATCH"} ${row.what}${note}`);
  }
  console.log(
    `\n${rulesPath}\n${rows.length} cases (${allows} ALLOW, ${rows.length - allows} DENY), ${bad} mismatched.`,
  );
  if (bad > 0) process.exitCode = 1;
}

await main();
