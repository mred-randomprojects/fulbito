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
/**
 * One function's body, braces balanced.
 *
 * It asserts that it found the function: a check that silently greps an empty
 * string is the same vacuous pass this file's own first draft shipped with.
 */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature} is gone — was it renamed?`);
  const open = source.indexOf("{", at + signature.length);
  assert.notEqual(open, -1, `${signature} has no body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(open + 1, i);
        assert.ok(body.length > 100, `${signature} came back suspiciously short`);
        return body;
      }
    }
  }
  assert.fail(`${signature} is not closed`);
}

function code(path: string): string {
  return stripComments(read(path));
}

/**
 * The source with its comments taken out.
 *
 * The checks below grep for words like "rating" and "total", and every one of
 * these files now *explains in a comment* why it does not draw one. Grepping
 * the raw text would fail on the explanation, which is the kind of test people
 * fix by deleting the comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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
   * El tercer tiempo's puntajes. **Anonymous, not hidden** — and the test
   * changed shape when the feature did, which is worth stating rather than
   * quietly rewriting.
   *
   * The first version of this file pinned "only the owner may read a ballot",
   * because the ballots were signed. They are not any more: a ballot carries
   * no uid and no name, the account that wrote it is named only by a marker
   * nobody may enumerate, and the page reads the pile to show "le pusieron 3
   * notas, 72" because there is no server to do that arithmetic. So what has
   * to be true is different, and narrower: a ballot may be read by anybody,
   * and must never be able to say *whose* it is.
   */
  it("keeps every name off el tercer tiempo's ballots", () => {
    const block = rulesBody(rules, "match /ballots/{ballotId}");
    // Two blocks are called that — a poll's and a recap's. The recap's is the
    // one that lets anybody read, so pick it by that and fail loudly if the
    // shape ever changes under this test.
    const recapBallots = rules
      .split("match /recaps/{recapId}")[1]
      .split("match /ballots/{ballotId}")[1];
    assert.ok(recapBallots !== undefined, "the recap ballots block is gone — was it renamed?");
    const body = recapBallots.slice(0, recapBallots.indexOf("match /voters"));

    for (const statement of body.split(";").map((part) => part.trim())) {
      if (!/^allow (create|update|write)/.test(statement)) continue;
      // Whatever a ballot may hold, it may not hold somebody's identity.
      for (const field of ["'uid'", "'name'", "'email'", "'author'"]) {
        assert.ok(
          !statement.includes(field),
          `a recap ballot may carry ${field} again: ${statement}`,
        );
      }
      assert.match(
        statement,
        /claims\(/,
        `a ballot that nobody's marker has to claim: ${statement}`,
      );
    }
    assert.ok(block.length > 0, "the ballots block came back empty");
  });

  /**
   * And nobody reads the pile but its owner. This file once let el tercer
   * tiempo's ballots be read by any session holding the link, on the argument
   * that an anonymous number is harmless and the page needed the pile to draw
   * a median. The organiser struck both: no number about anybody on that page,
   * not even an average, and the pile is the owner's to read like an
   * encuesta's. A voter still reads the one ballot their marker names, which
   * is how they come back to change it.
   */
  it("keeps el tercer tiempo's ballots to the owner and each to its voter", () => {
    const recapBallots = rules
      .split("match /recaps/{recapId}")[1]
      ?.split("match /ballots/{ballotId}")[1];
    assert.ok(recapBallots !== undefined, "the recap ballots block is gone — was it renamed?");
    const body = recapBallots.slice(0, recapBallots.indexOf("match /voters"));
    for (const statement of readLines(body)) {
      assert.match(
        statement,
        /isRecapOwner\(\)|isSiteOwner\(\)|claims\(/,
        `a read of el tercer tiempo's ballots that asks nobody anything: ${statement}`,
      );
      assert.doesNotMatch(
        statement,
        /if request\.auth != null;?$/,
        `el tercer tiempo's ballots are readable by any session again: ${statement}`,
      );
    }
  });

  /**
   * The other half, and the one that does the work: the markers that tie an
   * account to a ballot id. Open `list` to the owner and every anonymous
   * number has a name beside it again, in one query.
   */
  it("never lets anybody enumerate who voted", () => {
    for (const section of rules.split("match /voters/{voterId}").slice(1)) {
      const body = section.slice(0, section.indexOf("\n      }"));
      assert.match(body, /allow list: if false/, `voters became listable:\n${body}`);
      for (const statement of readLines(body)) {
        if (/^allow list/.test(statement)) continue;
        assert.match(
          statement,
          /request\.auth\.uid == voterId/,
          `a marker readable by somebody other than its own account: ${statement}`,
        );
      }
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

describe("a puntaje is secret: what leaves in a message", () => {
  /**
   * The two PNGs and the two blocks of text that get pasted into the grupo.
   *
   * These carry no number about anybody and there is no switch to make them:
   * "Mostrar los niveles" and "Mandar los niveles también" were opt-in and off
   * by default, and they went anyway, because a door that is shut by default is
   * still a door — one distracted tap and what you think each of them is worth
   * is in a chat that gets forwarded. A PNG is the least recallable thing this
   * app produces.
   *
   * A team total counts: it is its players' ratings with one subtraction in
   * between, and two totals plus one swap is somebody's number.
   */
  const renderers = ["src/lib/lineupImage.ts", "src/lib/tournamentImage.ts"];

  for (const path of renderers) {
    it(`${path} draws no rating and no total`, () => {
      const source = code(path);
      for (const word of [/\brating/i, /\btotal/i, /slotRatings/, /evaluation\./]) {
        assert.doesNotMatch(
          source,
          word,
          `${path} mentions ${word} again. This picture is made to be forwarded; ` +
            `read the header of this file before putting a number on it.`,
        );
      }
    });
  }

  /**
   * The text that goes in the chat, in both screens that build one.
   *
   * The whole file is not checked for either: `SplitPage` is a screen of your
   * own as well as a share, and the team cards on it show totals behind
   * `ScoresVisible`, which is right — that is you looking at your own numbers
   * on your own phone. The share is the part that leaves, so the share is the
   * part that is pinned, and the extraction asserts that it found a function
   * rather than quietly checking an empty string.
   */
  it("the text pasted into the grupo carries no number about anybody", () => {
    for (const path of ["src/components/ShareDialog.tsx", "src/components/SplitPage.tsx"]) {
      const body = functionBody(code(path), "function buildText(");
      for (const word of [/slotRatings/, /includeRatings/, /\.total\b/, /canShareScores/]) {
        assert.doesNotMatch(
          body,
          word,
          `buildText in ${path} is putting numbers in the message again. There is ` +
            `no opt-in for this any more: read the header of this file first.`,
        );
      }
    }
  });

  /** And the switch that used to turn them on is gone from the app. */
  it("has no sharing checkbox left to tick", () => {
    for (const path of [
      "src/components/ShareDialog.tsx",
      "src/components/SplitPage.tsx",
      "src/lib/scorePrivacy.ts",
    ]) {
      for (const word of [/canShareScores/, /includeRatings/, /requestedRatings/]) {
        assert.doesNotMatch(
          code(path),
          word,
          `the "mostrar los niveles" switch is back in ${path}. It was opt-in and ` +
            `off by default the first time, and it went anyway: read the header.`,
        );
      }
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
    {
      module: "lib/recapFeedback",
      why: "is what the grupo's puntajes add up to — medians, counts, la figura",
    },
  ];

  /**
   * `lib/recapFeedback` is banned from these pages outright, and it has been
   * here before. It was banned while el tercer tiempo's ballots were signed;
   * it was let back in, by name, when they became anonymous, so the public page
   * could draw "El grupo: 72 · 3 notas" and la figura; and the organiser threw
   * it out again: nobody gets to see what the grupo thinks of a player, not
   * even averaged. The owner reads it on their own app, which is the only
   * place that module is for.
   *
   * The module itself still may not mention a person, because the owner's
   * screens are no place for one either.
   */
  it("lib/recapFeedback hands out numbers, never a person", () => {
    const source = code("src/lib/recapFeedback.ts");
    for (const word of [/\bname\b/, /\buid\b/, /\bauthor\b/, /FeedbackLine/]) {
      assert.doesNotMatch(
        source,
        word,
        `lib/recapFeedback mentions ${word} again. Its ballots carry no name ` +
          `by design; read the header of this file first.`,
      );
    }
  });

  for (const page of pages) {
    it(`${page} imports nothing that adds up other people's opinions`, () => {
      const source = code(`src/components/${page}.tsx`);

      for (const { module, why } of forbidden) {
        assert.doesNotMatch(
          source,
          new RegExp(`from "(@/|\\.\\./)${module}"`),
          `${page} now imports ${module}, which ${why}. That page is opened by ` +
            `whoever was sent the link. Read the header of this file before changing it.`,
        );
      }
    });
  }
});
