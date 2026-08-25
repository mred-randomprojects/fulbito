/**
 * Turning a set of teams into a torneito.
 *
 * `groups.ts` answers "who plays with whom"; this answers "and then what". They
 * are separate on purpose: the split is a search over people and it is the
 * expensive, interesting part, while a fixture is a handful of pairings that
 * depend on nothing but how many teams there are. Keeping them apart means
 * flipping the format does not re-run the search, and re-rolling the split does
 * not change the fixture.
 *
 * Two formats, because a shared cancha is run two ways and neither is a
 * degenerate case of the other:
 *
 * - **Todos contra todos** is a fixture. Every pairing is known before a ball
 *   is kicked, so it can be drawn in full and pasted into the group chat.
 * - **El que gana se queda** is not. After the first match every pairing
 *   depends on a result nobody has yet, so all that can be written down is who
 *   starts and what the queue is. Pretending otherwise would mean printing a
 *   schedule that is wrong from minute one.
 *
 * Nothing here is stored, for the same reason `SplitPage` stores nothing: the
 * message you paste into the group chat is the record.
 */

export type TournamentFormat = "round-robin" | "winner-stays";

/** A pairing, by index into the split's teams. */
export interface FixtureMatch {
  home: number;
  away: number;
}

export interface FixtureRound {
  matches: FixtureMatch[];
  /** Who sits this one out. Only ever set when the team count is odd. */
  bye: number | null;
}

export interface RoundRobinFixture {
  format: "round-robin";
  rounds: FixtureRound[];
  /** Matches in the whole thing — n(n−1)/2, the number people ask about. */
  total: number;
  /** Matches each team gets. */
  each: number;
}

export interface WinnerStaysFixture {
  format: "winner-stays";
  opener: FixtureMatch;
  /** The rest, in the order they come on. */
  queue: number[];
}

export type Fixture = RoundRobinFixture | WinnerStaysFixture;

/** Enough of a team to write a fixture line about it. */
export interface FixtureTeamLabel {
  name: string;
  /** Stands in for the colour in a plain-text message. */
  emoji: string;
}

/**
 * Every pairing, laid out in rounds, by the circle method.
 *
 * An odd number of teams gets a phantom opponent, and whoever draws it is
 * libre that round — which is the honest answer rather than an error, because
 * five teams on one pitch is a completely normal night.
 *
 * The rounds are also the running order: they play one match at a time on one
 * pitch, and consecutive rounds are the cheapest way to spread the rest around.
 * With four teams two of the six changeovers still put a team straight back on,
 * and no ordering avoids that — it is a property of six matches between four
 * teams, not of this function.
 */
export function roundRobin(teamCount: number): FixtureRound[] {
  const n = Math.max(2, Math.floor(teamCount));
  const odd = n % 2 === 1;
  const slots = odd ? n + 1 : n;
  /** The phantom. Only ever present when `odd`, and always the last index. */
  const phantom = slots - 1;

  const order = Array.from({ length: slots }, (_, i) => i);
  const rounds: FixtureRound[] = [];

  for (let round = 0; round < slots - 1; round++) {
    const matches: FixtureMatch[] = [];
    let bye: number | null = null;

    for (let i = 0; i < slots / 2; i++) {
      const home = order[i];
      const away = order[slots - 1 - i];
      if (odd && (home === phantom || away === phantom)) {
        bye = home === phantom ? away : home;
        continue;
      }
      matches.push({ home, away });
    }

    rounds.push({ matches, bye });

    // Rotate every position but the first, which is what makes each team meet
    // each other team exactly once.
    const last = order.pop();
    if (last !== undefined) order.splice(1, 0, last);
  }

  return rounds;
}

/**
 * Who starts, and the order of the queue behind them.
 *
 * Index order, deliberately. The split has already made the teams as even as
 * it can, so there is no better team to hand the first match to, and a shuffle
 * here would only mean the same screen showing a different answer every render
 * for no reason anybody could explain.
 */
export function winnerStays(teamCount: number): WinnerStaysFixture {
  const n = Math.max(2, Math.floor(teamCount));
  return {
    format: "winner-stays",
    opener: { home: 0, away: 1 },
    queue: Array.from({ length: n - 2 }, (_, i) => i + 2),
  };
}

export function buildFixture(format: TournamentFormat, teamCount: number): Fixture {
  if (format === "winner-stays") return winnerStays(teamCount);
  const n = Math.max(2, Math.floor(teamCount));
  return {
    format: "round-robin",
    rounds: roundRobin(n),
    total: (n * (n - 1)) / 2,
    each: n - 1,
  };
}

/**
 * "20 en 4 equipos de 5", or "19 en 4 equipos (5-5-5-4)".
 *
 * Two forms because "4 equipos de 5" is a lie the moment the teams are not the
 * same size, and the uneven case is the one somebody is going to argue about —
 * so it prints the actual sizes rather than an average nobody can check.
 */
export function summariseShape(sizes: readonly number[]): string {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const people = `${total} ${total === 1 ? "jugador" : "jugadores"}`;
  if (sizes.length === 0) return people;

  const teams = `${sizes.length} ${sizes.length === 1 ? "equipo" : "equipos"}`;
  const even = sizes.every((size) => size === sizes[0]);
  return even
    ? `${people} en ${teams} de ${sizes[0]}`
    : `${people} en ${teams} (${sizes.join("-")})`;
}

/** Falls back rather than throwing: a label is never worth losing a fixture over. */
function labelOf(teams: readonly FixtureTeamLabel[], index: number): FixtureTeamLabel {
  return teams[index] ?? { name: `Equipo ${index + 1}`, emoji: "⚽" };
}

function matchLine(teams: readonly FixtureTeamLabel[], match: FixtureMatch): string {
  const home = labelOf(teams, match.home);
  const away = labelOf(teams, match.away);
  return `  ${home.emoji} ${home.name}  vs  ${away.emoji} ${away.name}`;
}

/** The fixture as lines for a group chat, rather than for a spreadsheet. */
export function fixtureLines(
  fixture: Fixture,
  teams: readonly FixtureTeamLabel[],
): string[] {
  if (fixture.format === "winner-stays") {
    const lines = ["🏁 Arrancan", matchLine(teams, fixture.opener)];
    if (fixture.queue.length > 0) {
      lines.push("", "⏳ Y van entrando");
      fixture.queue.forEach((index, position) => {
        const team = labelOf(teams, index);
        lines.push(`  ${position + 1}. ${team.emoji} ${team.name}`);
      });
    }
    lines.push("", "El que gana se queda. El que pierde va al final de la fila.");
    return lines;
  }

  const lines: string[] = [];
  fixture.rounds.forEach((round, index) => {
    if (index > 0) lines.push("");
    lines.push(`📋 Fecha ${index + 1}`);
    for (const match of round.matches) lines.push(matchLine(teams, match));
    if (round.bye != null) {
      const team = labelOf(teams, round.bye);
      lines.push(`  ${team.emoji} ${team.name} descansa`);
    }
  });
  return lines;
}
