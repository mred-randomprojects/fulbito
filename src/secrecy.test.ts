import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * **A puntaje is secret. This file is the tripwire.**
 *
 * Every other test here asks whether the code does what it means to. This one
 * asks whether somebody has quietly widened who may read what one person
 * thinks of another, because that is the one mistake in this app that cannot
 * be taken back: a person finding out that the grupo gave them 40s is not a
 * bug report, it is somebody's Thursday night ruined and possibly worse.
 *
 * It exists because we shipped exactly that and nearly kept it. El tercer
 * tiempo went out with `reviews` readable by any session with the link and the
 * page drawing everybody's medians, figura and lines. It read as a feature. It
 * passed a build, a test run, a rules suite and a review, because nothing
 * anywhere *asked the question* — the redaction tests pin what a published
 * document contains, and this was a leak in who may **read** it and in what a
 * public page **renders**.
 *
 * So the question is asked here, in `npm test`, in milliseconds, by grepping
 * the two places the answer lives:
 *
 *   1. `firestore.rules` — the server, the only thing that actually stops
 *      anybody. A page that merely does not draw a number is not a fix: the
 *      person holding the link holds a browser console too.
 *   2. The pages mounted *outside* `App` — the encuesta, la lista, el tercer
 *      tiempo, la votación. Those are the four screens somebody who is not
 *      you can open, and none of them may import the machinery that turns
 *      other people's opinions into a number.
 *
 * Grepping source text is a blunt instrument and deliberately so: it stays
 * true whatever the components are refactored into, it cannot be satisfied by
 * a mock, and when it fails it fails loudly at a line that says why.
 *
 * **If this test is in your way, stop.** It is not a lint rule to be updated
 * to match the new code. Every assertion here is a promise printed on a screen
 * somebody else reads, and changing one is a product decision that belongs to
 * the person whose grupo this is — see "Un puntaje es secreto" in `PROJECT.md`
 * and the "Stop and ask" list in `AGENTS.md`. Bring it to them before you
 * touch this file, and say plainly who would be able to see what.
 */

/**
 * A file from the repo, read off the working directory rather than off this
 * module's own path: `npm test` compiles into `.tmp/test-dist` and runs from
 * the root, so a relative walk up from here lands in the build output. The
 * marker check is so a wrong cwd fails saying that, rather than looking like
 * a rule that has gone missing.
 */
function read(path: string): string {
  const root = process.cwd();
  assert.ok(
    existsSync(join(root, "firestore.rules")),
    `run this from the repo root: no firestore.rules under ${root}`,
  );
  return readFileSync(join(root, path), "utf8");
}

/**
 * What is *inside* `match <path> { ... }` — the rules, without the header.
 *
 * Two details here are the whole reason this helper exists, and both of them
 * made it pass while the door stood open:
 *
 *   - Brace counting starts at the brace **after** the header. A path is
 *     written `match /reviews/{voterId}`, so counting from the header itself
 *     opens and closes on the wildcard and hands back a block with no rules in
 *     it.
 *   - The header is then dropped, because `allowLines` splits on `;` and a
 *     chunk that still carries `match /reviews/{voterId} {` in front of the
 *     first rule does not look like an `allow` and gets filtered away —
 *     silently taking the first rule with it, which is usually the read.
 *
 * Both of those turn a check into a loop over nothing. That is what the
 * asserts in `allowLines` and `readLines` are for.
 */
function rulesBody(rules: string, header: string): string {
  const at = rules.indexOf(header);
  assert.notEqual(at, -1, `${header} is gone from firestore.rules — was it renamed?`);
  const open = rules.indexOf("{", at + header.length);
  assert.notEqual(open, -1, `${header} has no body in firestore.rules`);
  let depth = 0;
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === "{") depth += 1;
    if (rules[i] === "}") {
      depth -= 1;
      if (depth === 0) return rules.slice(open + 1, i);
    }
  }
  assert.fail(`${header} is not closed in firestore.rules`);
}

/**
 * The `allow` statements in a block, conditions and all, comments dropped.
 *
 * It asserts that it found some. A helper that silently returns nothing turns
 * every caller into a loop over an empty list, and a rule nobody checked looks
 * exactly like a rule that passed.
 */
function allowLines(block: string): string[] {
  const statements = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("//"))
    .join(" ")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith("allow "));
  assert.ok(statements.length > 0, `no allow rules found in this block:\n${block}`);
  return statements;
}

/**
 * The read rules in a block, and there is always at least one: a collection
 * nobody may read is not how any of this works, so zero of them means the
 * block was misparsed and the check below would be vacuous.
 */
function readLines(block: string): string[] {
  const reads = allowLines(block).filter((statement) => /^allow (read|get|list)/.test(statement));
  assert.ok(reads.length > 0, `no read rule found in this block:\n${block}`);
  return reads;
}

describe("a puntaje is secret: the server", () => {
  const rules = read("firestore.rules");

  /**
   * One person's ballot about how the others played. Readable by the owner —
   * who asked for it — and by its own author, and by nobody else with the
   * link. `allow read` would cover `list` as well, which is the shape the
   * original leak had.
   */
  it("keeps el tercer tiempo's ballots off the link", () => {
    const block = rulesBody(rules, "match /reviews/{voterId}");
    for (const statement of readLines(block)) {
      assert.match(
        statement,
        /isRecapOwner\(\)/,
        `a read of a puntaje that does not ask who the owner is: ${statement}`,
      );
      assert.doesNotMatch(
        statement,
        /^allow (read|get|list)[^:]*: if request\.auth != null\s*$/,
        `any session may read the puntajes again: ${statement}`,
      );
    }
  });

  /**
   * An encuesta's ballots are the same class of secret, one step further: the
   * numbers are what the owner reads, and *who sent which* is the super
   * admins' alone. Neither is ever readable by whoever holds the link.
   */
  it("keeps an encuesta's ballots to the owner and the admins", () => {
    const block = rulesBody(rules, "match /ballots/{ballotId}");
    for (const statement of readLines(block)) {
      assert.match(
        statement,
        /isOwner\(\)|isSuperAdmin\(\)|isSiteOwner\(\)|claims\(/,
        `a read of an encuesta ballot that asks nobody anything: ${statement}`,
      );
    }
  });

  /** And who sent one stays with the two accounts that maintain the app. */
  it("keeps who-sent-which to the super admins", () => {
    const block = rulesBody(rules, "match /identities/{ballotId}");
    for (const statement of readLines(block)) {
      assert.match(statement, /isSuperAdmin\(\)/, `who voted is readable: ${statement}`);
    }
  });
});

describe("a puntaje is secret: the pages anybody can open", () => {
  /**
   * The four screens mounted beside `App` in `main.tsx`. Whoever is on one of
   * them is not using the app — they were sent a link — so none of them may
   * hold the machinery that averages other people's opinions, or a rating
   * scale's worth of somebody else's numbers.
   *
   * `myReview` is allowed through by name: your own ballot, read back so you
   * can change it, is the one thing on these pages that is yours.
   */
  const pages = ["PollPage", "ListPage", "RecapPage", "VotePage"];

  /**
   * Modules a page outside the wall may not import at all. Each one either
   * adds other people's answers up or is a rating; on these four screens
   * there is nothing legitimate to do with either. Checked as *imports*
   * rather than as words, so the Spanish for "figura" can go on being printed
   * on a button.
   */
  const forbidden: { module: string; why: string }[] = [
    { module: "lib/crowd", why: "is what a pile of other people's votes is worth" },
    { module: "lib/pollAudit", why: "is who sent which ballot" },
    { module: "lib/pollHistory", why: "is every encuesta ever sent" },
    { module: "lib/voteSwarm", why: "draws every individual vote as a dot" },
    { module: "lib/stats", why: "is a record read off everybody's matches" },
    { module: "lib/rating", why: "is what a player is worth" },
    { module: "lib/balance", why: "scores a team, which is its players' ratings" },
    { module: "lib/groups", why: "scores a split, which is the same numbers" },
    { module: "lib/insights", why: "says out loud which side is better" },
  ];

  /**
   * `lib/recapFeedback` is the module the leak came through, so it gets the
   * narrower rule: one binding, by name. `myReview` is your own ballot read
   * back so you can change it — the one thing on these pages that is yours.
   */
  const FEEDBACK_ALLOWED = ["myReview"];

  for (const page of pages) {
    it(`${page} imports nothing that adds up other people's opinions`, () => {
      const source = read(`src/components/${page}.tsx`);

      for (const { module, why } of forbidden) {
        assert.doesNotMatch(
          source,
          new RegExp(`from "(@/|\\.\\./)${module}"`),
          `${page} now imports ${module}, which ${why}. That page is opened by ` +
            `whoever was sent the link. Read the header of this file before changing it.`,
        );
      }

      const feedback = /import\s*{([^}]*)}\s*from\s*"@\/lib\/recapFeedback"/.exec(source);
      if (feedback === null) return;
      const imported = feedback[1]
        .split(",")
        .map((name) => name.replace(/^\s*type\s+/, "").trim())
        .filter((name) => name !== "");
      for (const name of imported) {
        assert.ok(
          FEEDBACK_ALLOWED.includes(name),
          `${page} now imports ${name} from lib/recapFeedback. Everything there but ` +
            `${FEEDBACK_ALLOWED.join(", ")} is other people's puntajes, and this page is ` +
            `opened by whoever was sent the link. Read the header of this file first.`,
        );
      }
    });
  }
});
