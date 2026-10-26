import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTorneoGame,
  cycleTorneoPin,
  evenSizes,
  isTorneoHost,
  ligaPlan,
  maxFields,
  newTorneo,
  nextLigaRound,
  plannedTurns,
  replaceTorneoPlayer,
  resizeTorneo,
  setTeamKit,
  setTeamSize,
  startTorneo,
  swapInTorneoGames,
  swapTorneoPlayers,
  syncTorneoGames,
  teamOf,
  torneoArmado,
  torneoCourtCost,
  torneoFinishes,
  torneoFixture,
  torneoForSquad,
  torneoGamesOf,
  torneoProgress,
  torneoShareText,
  torneoTable,
  torneoTeamName,
  TorneoError,
  withPlayers,
} from "./torneo.js";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  type Match,
  type MatchId,
  type MatchResult,
  type Player,
  type PlayerId,
  type TeamKey,
  type Torneo,
} from "../types.js";

let counter = 0;
function person(name: string, rating = 87): Player {
  counter += 1;
  return {
    id: `p${counter}` as PlayerId,
    firstName: name,
    lastName: "",
    nickname: "",
    ratingScale: RATING_SCALE,
    avatar: "",
    rating,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function host(torneo: Torneo, squad: readonly PlayerId[] = [], extras: Partial<Match> = {}): Match {
  return {
    id: "host" as MatchId,
    name: "Copa del jueves",
    date: "2026-10-23",
    ratingScale: RATING_SCALE,
    teamA: { ...DEFAULT_TEAM_A },
    teamB: { ...DEFAULT_TEAM_B },
    squad: [...squad],
    pins: {},
    sizeA: 0,
    sizeB: 0,
    lineupA: [],
    lineupB: [],
    basis: "total",
    respectAvoids: true,
    respectTogether: true,
    handicap: 0,
    result: null,
    courtCost: 0,
    payments: {},
    notes: "",
    reviews: {},
    forecastNotes: "",
    videos: [],
    torneo,
    updatedAt: "2026-10-23T00:00:00.000Z",
    ...extras,
  };
}

/** Twenty people in four armados fives. */
function night(format: Torneo["format"] = "liga") {
  const people = Array.from({ length: 20 }, (_, i) => person(`J${i + 1}`, 40 + i));
  const ids = people.map((p) => p.id);
  const torneo = withPlayers({ ...newTorneo(20, 4), format }, [
    ids.slice(0, 5),
    ids.slice(5, 10),
    ids.slice(10, 15),
    ids.slice(15, 20),
  ]);
  return { people, ids, match: host(torneo, ids) };
}

let made = 0;
const makeId = () => `m${(made += 1)}` as MatchId;
const NOW = "2026-10-23T22:00:00.000Z";

function scored(game: Match, result: MatchResult | null, decider?: TeamKey): Match {
  const torneoGame = game.torneoGame;
  return {
    ...game,
    result,
    ...(torneoGame === undefined
      ? {}
      : { torneoGame: { ...torneoGame, ...(decider === undefined ? {} : { decider }) } }),
  };
}

describe("setting a torneo up", () => {
  it("opens with even sizes, bright bibs, nobody placed, and canchas the teams can fill", () => {
    const torneo = newTorneo(20, 4);
    assert.deepEqual(torneo.teams.map((team) => team.size), [5, 5, 5, 5]);
    assert.deepEqual(torneo.teams.map((team) => team.kit), ["red", "blue", "green", "yellow"]);
    assert.ok(torneo.teams.every((team) => team.players.length === 0));
    assert.equal(torneo.fields, 2);
    assert.equal(newTorneo(15, 3).fields, 1, "three teams can only ever use one cancha at a time");
    assert.equal(torneoArmado(torneo), false);
  });

  it("calls a team by its bibs until somebody names it", () => {
    assert.equal(torneoTeamName({ name: "  ", kit: "red" }), "Rojos");
    assert.equal(torneoTeamName({ name: "Los Pibes", kit: "red" }), "Los Pibes");
  });

  it("keeps the names and bibs of the teams that survive a change of count", () => {
    const named = {
      ...newTorneo(20, 4),
      teams: newTorneo(20, 4).teams.map((team, i) => ({ ...team, name: `T${i}` })),
      pins: { a: 3, b: 1 } as Torneo["pins"],
    };
    const three = resizeTorneo(named, 20, 3);
    assert.deepEqual(three.teams.map((team) => team.name), ["T0", "T1", "T2"]);
    assert.deepEqual(three.teams.map((team) => team.size), [7, 7, 6]);
    assert.deepEqual(three.pins, { b: 1 }, "a pin on the team that went stops applying");

    const five = resizeTorneo(three, 20, 5);
    assert.deepEqual(five.teams.map((team) => team.kit), ["red", "blue", "green", "yellow", "orange"]);
    assert.equal(new Set(five.teams.map((team) => team.kit)).size, 5);
  });

  it("never goes below three teams or above eight", () => {
    assert.equal(resizeTorneo(newTorneo(20, 4), 20, 2).teams.length, 3);
    assert.equal(resizeTorneo(newTorneo(20, 4), 20, 12).teams.length, 8);
  });

  it("drops the split whenever its shape changes", () => {
    const { match } = night();
    const torneo = match.torneo!;
    assert.equal(torneoArmado(torneo), true);
    assert.equal(torneoArmado(setTeamSize(torneo, 0, 6)), false);
    assert.equal(torneoArmado(evenSizes(torneo, 20)), false);
  });

  it("deals the sizes again when somebody joins or leaves, and forgets the leaver's pin", () => {
    const { match, ids } = night();
    const pinned = { ...match.torneo!, pins: { [ids[0]]: 2, [ids[1]]: 1 } as Torneo["pins"] };
    const after = torneoForSquad(pinned, ids.slice(1));
    assert.deepEqual(after.teams.map((team) => team.size), [5, 5, 5, 4]);
    assert.deepEqual(after.pins, { [ids[1]]: 1 });
    assert.equal(torneoArmado(after), false);
  });

  it("cycles the padlock through every team and back to loose", () => {
    let torneo = newTorneo(9, 3);
    const id = "x" as PlayerId;
    const seen: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      torneo = cycleTorneoPin(torneo, id);
      seen.push(torneo.pins[id]);
    }
    assert.deepEqual(seen, [0, 1, 2, undefined]);
  });

  it("swaps two people between teams, and ignores two on the same one", () => {
    const { match, ids } = night();
    const swapped = swapTorneoPlayers(match.torneo!, ids[0], ids[7]);
    assert.equal(teamOf(swapped).get(ids[0]), 1);
    assert.equal(teamOf(swapped).get(ids[7]), 0);
    assert.equal(swapTorneoPlayers(match.torneo!, ids[0], ids[1]), match.torneo);
  });

  it("hands over the bibs when one team takes another's", () => {
    const torneo = setTeamKit(newTorneo(20, 4), 0, "blue");
    assert.deepEqual(torneo.teams.map((team) => team.kit).slice(0, 2), ["blue", "red"]);
  });

  it("prices the night per cancha only while a price per cancha is set", () => {
    assert.equal(torneoCourtCost({ fieldPrice: 0, fields: 2 }), null);
    assert.equal(torneoCourtCost({ fieldPrice: 45000, fields: 2 }), 90000);
    assert.equal(
      torneoCourtCost({ fieldPrice: 99_999_999, fields: 2 }),
      99_999_999,
      "never a bill the match cannot store",
    );
    assert.equal(maxFields(5), 2);
    assert.equal(maxFields(3), 1);
  });

  it("is a host only when it is not itself a game of one", () => {
    const { match } = night();
    assert.equal(isTorneoHost(match), true);
    assert.equal(
      isTorneoHost({ ...match, tournament: { id: "x", name: "x", turn: 1, field: 1 } }),
      false,
    );
  });
});

describe("the liga's fixture", () => {
  it("plays everybody once, nobody twice in a turn, packed onto the canchas", () => {
    const plan = ligaPlan(4, 2);
    assert.equal(plan.length, 6);
    const pairs = new Set(plan.map((game) => [...game.sides].sort().join("-")));
    assert.equal(pairs.size, 6);
    const turns = new Map<number, number[]>();
    for (const game of plan) turns.set(game.turn, [...(turns.get(game.turn) ?? []), ...game.sides]);
    assert.equal(turns.size, 3);
    for (const teams of turns.values()) assert.equal(new Set(teams).size, teams.length);
  });

  it("gives five teams a rest each round rather than a phantom game", () => {
    const plan = ligaPlan(5, 2);
    assert.equal(plan.length, 10);
    assert.equal(Math.max(...plan.map((game) => game.turn)), 5);
  });

  it("runs a round over more turns when there are fewer canchas", () => {
    assert.equal(Math.max(...ligaPlan(4, 1).map((game) => game.turn)), 6);
  });
});

describe("startTorneo", () => {
  it("makes every liga game a match with both lineups, tagged to the night", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    assert.equal(games.length, 6);
    const first = games[0];
    assert.equal(first.tournament?.id, "host");
    assert.equal(first.tournament?.name, "Copa del jueves");
    assert.deepEqual(first.torneoGame?.sides, [0, 3]);
    assert.equal(first.name, "Rojos vs Amarillos");
    assert.equal(first.teamA.kit, "red");
    assert.equal(first.teamB.kit, "yellow");
    assert.equal(first.courtCost, 0, "the night's money stays on the night");
    assert.deepEqual(
      [...first.lineupA].filter((id) => id !== null).sort(),
      [...match.torneo!.teams[0].players].sort(),
    );
    assert.equal(first.date, match.date);
  });

  it("makes only the copa's first round, since nobody knows the rest yet", () => {
    const { match, people } = night("copa");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    assert.deepEqual(
      games.map((game) => [game.torneoGame?.round, game.torneoGame?.slot, ...(game.torneoGame?.sides ?? [])]),
      [
        [1, 0, 0, 3],
        [1, 1, 1, 2],
      ],
    );
  });

  it("refuses before the teams are armados", () => {
    const people = [person("a"), person("b"), person("c")];
    const match = host(newTorneo(3, 3), people.map((p) => p.id));
    assert.throws(() => startTorneo({ host: match, players: people, now: NOW, makeId }), TorneoError);
  });

  it("refuses a game for a team whose players are all gone from the roster", () => {
    const { match } = night();
    assert.throws(
      () =>
        buildTorneoGame({
          host: match,
          plan: { sides: [0, 1], turn: 1, field: 1 },
          players: [],
          id: makeId(),
          now: NOW,
        }),
      TorneoError,
    );
  });

  it("adds another vuelta after the last turn", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    const more = nextLigaRound({ host: match, players: people, now: NOW, makeId, games });
    assert.equal(more.length, 6);
    assert.equal(Math.min(...more.map((game) => game.tournament?.turn ?? 0)), 4);
  });

  it("finds the night's games among everything else, in board order", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    const found = torneoGamesOf(match.id, [match, ...[...games].reverse()]);
    assert.deepEqual(found.map((game) => game.id), games.map((game) => game.id));
  });
});

describe("reading a liga back", () => {
  it("orders the table by points, then goal difference, then goals, then the armado order", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    // 0-3 and 1-2 in turn one: Rojos beat Amarillos 2-0, Azules and Verdes draw 1-1.
    const results = [scored(games[0], { goalsA: 2, goalsB: 0 }), scored(games[1], { goalsA: 1, goalsB: 1 })];
    const table = torneoTable(match.torneo!, results);
    assert.deepEqual(
      table.map((row) => [row.name, row.points]),
      [
        ["Rojos", 3],
        ["Azules", 1],
        ["Verdes", 1],
        ["Amarillos", 0],
      ],
    );
    const progress = torneoProgress(match.torneo!, [...results, ...games.slice(2)]);
    assert.deepEqual([progress.played, progress.total, progress.leader, progress.champion], [2, 6, 0, null]);
  });

  it("names the champion once every game is in", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId }).map((game) => {
      const [a] = game.torneoGame!.sides;
      // Azules win everything they play.
      return scored(game, a === 1 ? { goalsA: 1, goalsB: 0 } : game.torneoGame!.sides[1] === 1 ? { goalsA: 0, goalsB: 1 } : { goalsA: 0, goalsB: 0 });
    });
    assert.equal(torneoProgress(match.torneo!, games).champion, 1);
  });
});

describe("keeping the games in step with the night", () => {
  it("renames a team on its games, and the game too while it still has its born name", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    const custom = { ...games[1], name: "El clásico" };
    const after = {
      ...match,
      torneo: { ...match.torneo!, teams: match.torneo!.teams.map((t, i) => (i === 0 ? { ...t, name: "Los Pibes" } : t)) },
    };
    const changed = syncTorneoGames(match, after, [games[0], custom, games[2]]);
    const renamed = changed.find((game) => game.id === games[0].id)!;
    assert.equal(renamed.name, "Los Pibes vs Amarillos");
    assert.equal(renamed.teamA.name, "Los Pibes");
    // games[1] is 1 v 2 and games[2] does not involve team 0 either: only
    // games with Rojos in them change.
    assert.ok(changed.every((game) => game.torneoGame!.sides.includes(0)));
  });

  it("carries a swap after Arrancar onto every game the two are in, played ones too", () => {
    const { match, people, ids } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    const [x, y] = [ids[0], ids[5]]; // Rojos and Azules
    const played = games.map((game) => scored(game, { goalsA: 2, goalsB: 1 }));
    const changed = swapInTorneoGames(played, x, y);
    const involving = (team: number) => games.filter((game) => game.torneoGame!.sides.includes(team));
    assert.equal(changed.length, new Set([...involving(0), ...involving(1)].map((game) => game.id)).size);
    for (const game of changed) {
      const [i, j] = game.torneoGame!.sides;
      const side = (team: number) => (i === team ? game.lineupA : j === team ? game.lineupB : null);
      assert.equal(game.result?.goalsA, 2, "the score stays");
      if (side(0) !== null) {
        assert.ok(side(0)!.includes(y) && !side(0)!.includes(x));
      }
      if (side(1) !== null) {
        assert.ok(side(1)!.includes(x) && !side(1)!.includes(y));
      }
      assert.equal(new Set(game.squad).size, game.squad.length, "nobody twice");
      assert.ok(Object.values(game.pins).length === Object.keys(game.pins).length);
    }
    // Amarillos vs Verdes has neither of them and is not written.
    assert.ok(changed.every((game) => game.torneoGame!.sides.some((team) => team === 0 || team === 1)));
  });

  it("puts somebody loose in a team in place of somebody, on the night and on its games", () => {
    const { match, people, ids } = night("liga");
    const late = person("Tardío");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    const torneo = replaceTorneoPlayer(match.torneo!, ids[0], late.id);
    assert.ok(torneo.teams[0].players.includes(late.id));
    assert.ok(!torneo.teams.some((team) => team.players.includes(ids[0])), "the one replaced is loose now");
    const changed = swapInTorneoGames(games, ids[0], late.id);
    assert.ok(changed.length > 0);
    assert.ok(changed.every((game) => game.squad.includes(late.id) && !game.squad.includes(ids[0])));
    // Somebody already on a team is swapped, not replaced.
    assert.equal(replaceTorneoPlayer(match.torneo!, ids[0], ids[5]), match.torneo);
  });

  it("leaves the uno x uno where it was", () => {
    const { match, people, ids } = night("liga");
    const [game] = startTorneo({ host: match, players: people, now: NOW, makeId });
    const reviewed: Match = { ...game, reviews: { [ids[0]]: "Le pegó de todos lados." } };
    const [changed] = swapInTorneoGames([reviewed], ids[0], ids[15]);
    assert.deepEqual(changed.reviews, reviewed.reviews);
  });

  it("moves the bibs only when the night's bibs changed", () => {
    const { match, people } = night("liga");
    const [game] = startTorneo({ host: match, players: people, now: NOW, makeId });
    const ownKit = { ...game, teamA: { ...game.teamA, kit: "purple" as const } };
    const renamedTorneo = { ...match, name: "Otra" };
    assert.equal(syncTorneoGames(match, renamedTorneo, [ownKit])[0].teamA.kit, "purple");
    const rekitted = { ...match, torneo: setTeamKit(match.torneo!, 0, "orange") };
    assert.equal(syncTorneoGames(match, rekitted, [ownKit])[0].teamA.kit, "orange");
  });

  it("moves the date only onto the games still on the night's date", () => {
    const { match, people } = night("liga");
    const [a, b] = startTorneo({ host: match, players: people, now: NOW, makeId });
    const later = { ...b, date: "2026-10-30" };
    const moved = { ...match, date: "2026-10-24" };
    const changed = syncTorneoGames(match, moved, [a, later]);
    assert.deepEqual(changed.map((game) => [game.id, game.date]), [[a.id, "2026-10-24"]]);
  });

  it("writes nothing when nothing a game shows changed", () => {
    const { match, people } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    assert.deepEqual(syncTorneoGames(match, { ...match, notes: "hola" }, games), []);
  });
});

describe("torneoFinishes", () => {
  function copaNight(third: boolean) {
    const { match, people, ids } = night("copa");
    const withThird = { ...match, torneo: { ...match.torneo!, thirdPlace: third } };
    const [semi1, semi2] = startTorneo({ host: withThird, players: people, now: NOW, makeId });
    // Semis: 0 v 3 → 3 wins; 1 v 2 → 1 wins. Final 3 v 1 → 1 wins. Third 0 v 2 → 0 wins.
    const games = [
      scored(semi1, { goalsA: 0, goalsB: 1 }),
      scored(semi2, { goalsA: 2, goalsB: 0 }),
      scored(
        buildTorneoGame({ host: withThird, plan: { sides: [3, 1], turn: 2, field: 1, round: 2, slot: 0 }, players: people, id: makeId(), now: NOW }),
        { goalsA: 1, goalsB: 1 },
        "B",
      ),
    ];
    if (third) {
      games.push(
        scored(
          buildTorneoGame({ host: withThird, plan: { sides: [0, 2], turn: 2, field: 2, round: 2, slot: 1 }, players: people, id: makeId(), now: NOW }),
          { goalsA: 3, goalsB: 2 },
        ),
      );
    }
    return { all: [withThird, ...games], ids };
  }

  it("reads the whole podium of a copa off its games", () => {
    const { all, ids } = copaNight(true);
    const label = (id: PlayerId) => torneoFinishes(all, id)[0];
    assert.deepEqual([label(ids[5]).place, label(ids[5]).label], [1, "Campeón"]);
    assert.deepEqual([label(ids[15]).place, label(ids[15]).label], [2, "Subcampeón"]);
    assert.deepEqual([label(ids[0]).place, label(ids[0]).label], [3, "3er puesto"]);
    assert.deepEqual([label(ids[10]).place, label(ids[10]).label], [4, "4° puesto"]);
    assert.equal(label(ids[0]).teamName, "Rojos");
  });

  it("calls both of them semifinalists when the third place was not played", () => {
    const { all, ids } = copaNight(false);
    assert.equal(torneoFinishes(all, ids[0])[0].label, "Semifinal");
    assert.equal(torneoFinishes(all, ids[10])[0].label, "Semifinal");
  });

  it("says a liga is still on rather than guessing, and the place once it ends", () => {
    const { match, people, ids } = night("liga");
    const games = startTorneo({ host: match, players: people, now: NOW, makeId });
    assert.equal(torneoFinishes([match, ...games], ids[0])[0].label, "En juego");
    const done = games.map((game) => scored(game, game.torneoGame!.sides.includes(3) ? (game.torneoGame!.sides[0] === 3 ? { goalsA: 0, goalsB: 5 } : { goalsA: 5, goalsB: 0 }) : { goalsA: 1, goalsB: 1 }));
    const last = torneoFinishes([match, ...done], ids[15])[0];
    assert.deepEqual([last.place, last.label, last.done], [4, "4° de 4", true]);
  });

  it("skips torneos that never started and the ones the player was not in", () => {
    const { match } = night("liga");
    assert.deepEqual(torneoFinishes([match], match.torneo!.teams[0].players[0]), []);
    assert.deepEqual(torneoFinishes([match], "nobody" as PlayerId), []);
  });
});

describe("torneoShareText", () => {
  it("has the teams, the fixture and the names, and no number about anybody", () => {
    const { match, people } = night("liga");
    const byId = new Map(people.map((p) => [p.id, p]));
    const before = torneoShareText(match, [], byId);
    assert.match(before, /Rojos \(5\)/);
    assert.match(before, /• J1\b/);
    assert.match(before, /Turno 1/);
    for (const player of people) assert.ok(!before.includes(String(player.rating)), `rating ${player.rating} leaked`);
  });

  it("writes the bracket with los penales and the champion", () => {
    const { match, people } = night("copa");
    const byId = new Map(people.map((p) => [p.id, p]));
    const [semi1, semi2] = startTorneo({ host: match, players: people, now: NOW, makeId });
    const text = torneoShareText(match, [scored(semi1, { goalsA: 2, goalsB: 2 }, "A"), scored(semi2, { goalsA: 1, goalsB: 0 })], byId);
    assert.match(text, /Semi 1: 🔴 Rojos 2 - 2 🟡 Amarillos \(pasó 🔴 Rojos\)/);
    assert.match(text, /Final: 🔴 Rojos vs 🔵 Azules/);
  });
});

describe("torneoFixture", () => {
  it("is the liga's fechas, every pairing once", () => {
    const fixture = torneoFixture(newTorneo(20, 4));
    assert.equal(fixture.format, "round-robin");
    if (fixture.format === "round-robin") assert.equal(fixture.total, 6);
  });

  it("is the copa's first round, the byes, and what comes after in words", () => {
    const fixture = torneoFixture({ ...newTorneo(25, 5), format: "copa" });
    assert.deepEqual(fixture, {
      format: "knockout",
      opening: [{ home: 3, away: 4 }],
      byes: [0, 1, 2],
      then: "Después: semis, final y 3er puesto.",
    });
    const three = torneoFixture({ ...newTorneo(12, 3), format: "copa" });
    assert.equal(three.format === "knockout" ? three.then : "", "Después: final.");
  });
});

describe("the board before Arrancar", () => {
  it("shows the copa's opening games with their names", () => {
    const { match } = night("copa");
    const turns = plannedTurns(match.torneo!);
    assert.deepEqual(
      turns.map((turn) => turn.games.map((game) => game.label)),
      [["Semi 1", "Semi 2"]],
    );
  });
});
