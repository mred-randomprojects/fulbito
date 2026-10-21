import { TIME, anon, google, type Data, type Row, type World } from "./harness.ts";

/**
 * The matrix: every request the app makes, as the account that makes it
 * (`L-…`, must be allowed), every attack worth naming (`A-…`, must be
 * refused), and the few things the rules knowingly let through (`N-…`,
 * allowed and said so). `was` is what the rules before the October 2026
 * hardening answered where it differs, so `--before` shows each hole open.
 *
 * Every document a rule may look at is in the case's world — `get`, `exists`,
 * `getAfter` and `existsAfter` are all mocks — and the runner fails a case
 * whose rules looked at one that is not, so a refusal is never an accident
 * of a missing mock.
 *
 * What this cannot see is anything that spans a request: a batch's
 * twenty-access ceiling, the per-request document cache. `src/cloud/rules.test.ts`
 * runs the app's own cloud modules against the emulator for those.
 */

const OWNER = google("owner-1", "owner@example.com");
const STRANGER = google("stranger", "stranger@example.com");
const VOTER = google("voter-1", "voter@example.com");
const ANON = anon("anon-x");
const ANON_Y = anon("anon-y");
/** `isSiteOwner()` and `isSuperAdmin()`. */
const SITE_OWNER = google("admin-1", "maxiredigonda@gmail.com");
/** `isSuperAdmin()` only. */
const OTHER_ADMIN = google("admin-2", "bruno.david9914@gmail.com");

/** A string the API does not turn into a timestamp, for fields the rules want as strings. */
const SEEN = "2026-10-16 12:00";
/** A photo the size `lib/image.ts` makes: up to 60 KB decoded, so ~80 KB of base64. */
const BIG_AVATAR = `data:image/jpeg;base64,${"/9j/".repeat(20_000)}`;
const AVATAR = `data:image/jpeg;base64,${"QUFB".repeat(50)}`;

const face = (ownerUid: string, avatar = AVATAR): Data => ({ ownerUid, name: "Maxi", avatar });

const poll: Data = { ownerUid: "owner-1", title: "Ranking", createdAt: SEEN, ignored: ["pb-ignored"] };
const lst: Data = { ownerUid: "owner-1", title: "Jueves", date: "2026-10-16", cap: 10, createdAt: SEEN };
const side = (name: string, kit: string, players: string[]): Data => ({ name, kit, players });
const recap: Data = {
  ownerUid: "owner-1",
  title: "Jueves",
  date: "2026-10-16",
  goalsA: 3,
  goalsB: 2,
  a: side("Claros", "light", ["p1"]),
  b: side("Oscuros", "dark", ["p2"]),
  videos: [{ url: "https://youtu.be/abcdefghijk", label: "" }],
  pollId: "P1",
  createdAt: SEEN,
};
const pick: Data = {
  ownerUid: "owner-1",
  title: "Jueves",
  date: "2026-10-16",
  options: [
    { a: side("Claros", "light", ["p1"]), b: side("Oscuros", "dark", ["p2"]) },
    { a: side("Claros", "light", ["p2"]), b: side("Oscuros", "dark", ["p1"]) },
  ],
  createdAt: SEEN,
};
const entry = (uid: string, name = "Maxi"): Data => ({ name, uid, at: TIME });
const comment = (uid: string): Data => ({ uid, name: "V", text: "golazo", at: TIME });
const recapBallot: Data = { players: { p1: { score: 70, thumb: "up" } }, mvp: "p1", at: TIME };
const pickBallot = (options: number[]): Data => ({ options, at: TIME });

/**
 * One world for everything: what exists, and what is known not to. Match ids:
 *   M1  the organiser's lista, tercer tiempo and votación, all up
 *   M4  the organiser's votación only
 *   M5  the organiser's lista only — its link is the one in the grupo
 *   M7  the organiser's tercer tiempo only
 *   M8  nothing yet
 */
const W: World = {
  "polls/P1": poll,
  "polls/P1/voters/voter-1": { ballotId: "pb1" },
  "polls/P1/voters/stranger": null,
  "polls/P1/ballots/pb1": { votes: {} },
  "polls/P1/ballots/pb-ignored": { votes: { p1: { overall: 20 } } },
  "polls/P1/ballots/pb-fresh": null,
  "polls/P2": null,
  "polls/P2/voters/voter-1": null,
  "polls/P2/ballots/pb-fresh": null,

  "lists/M1": lst,
  "recaps/M1": recap,
  "picks/M1": pick,
  "recaps/M1/voters/voter-1": { ballotId: "rb1" },
  "recaps/M1/voters/stranger": null,
  "recaps/M1/voters/anon-x": null,
  "recaps/M1/voters/owner-1": null,
  "recaps/M1/ballots/rb1": recapBallot,
  "recaps/M1/ballots/rb-ignored": recapBallot,
  "recaps/M1/ballots/rb-fresh": null,

  "lists/M4": null,
  "recaps/M4": null,
  "picks/M4": pick,
  "lists/M5": lst,
  "recaps/M5": null,
  "picks/M5": null,
  "lists/M7": null,
  "recaps/M7": recap,
  "picks/M7": null,
  "lists/M8": null,
  "recaps/M8": null,
  "picks/M8": null,
};

/** M1 with the thread and the vote shut. */
const SHUT: World = { ...W, "recaps/M1": { ...recap, closed: true }, "picks/M1": { ...pick, closed: true } };

type Spec = Omit<Row, "id" | "what" | "expect" | "was">;

function row(id: string, what: string, expect: Row["expect"], spec: Spec, was?: Row["expect"]): Row {
  return { id, what, expect, ...(was === undefined ? {} : { was }), world: W, ...spec };
}

const allow = (id: string, what: string, spec: Spec, was?: Row["expect"]) => row(id, what, "ALLOW", spec, was);
const deny = (id: string, what: string, spec: Spec, was?: Row["expect"]) => row(id, what, "DENY", spec, was);

/* ------------------------------------------------------------------ */
/* What the app does, as whoever does it: allowed, before and after.   */
/* ------------------------------------------------------------------ */

const ISLANDS: Row[] = [
  allow("L-U1", "owner reads own player (subscribeCloud)", { who: OWNER, method: "get", path: "users/owner-1/players/p1", existing: { firstName: "Maxi" } }),
  allow("L-U2", "owner lists own matches (subscribeCloud)", { who: OWNER, method: "list", path: "users/owner-1/matches/m1", existing: { id: "m1" } }),
  allow("L-U3", "owner puts a player, photo and all (applyPlan)", { who: OWNER, method: "create", path: "users/owner-1/players/p1", data: { id: "p1", firstName: "Maxi", avatar: BIG_AVATAR, rating: 70 } }),
  allow("L-U4", "owner overwrites a match (applyPlan)", { who: OWNER, method: "update", path: "users/owner-1/matches/m1", data: { id: "m1", name: "x" }, existing: { id: "m1" } }),
  allow("L-U5", "owner deletes a team (applyPlan)", { who: OWNER, method: "delete", path: "users/owner-1/teams/t1", existing: { id: "t1" } }),
  allow("L-U6", "owner writes the tombstone book (applyPlan)", { who: OWNER, method: "update", path: "users/owner-1/meta/tombstones", data: { deletedPlayers: [], deletedMatches: [], deletedTeams: [] }, existing: {} }),
  allow("L-U7", "owner writes meta/sync (writeSyncConsent)", { who: OWNER, method: "create", path: "users/owner-1/meta/sync", data: { enabled: true, changedAt: SEEN } }),
  allow("L-U8", "owner reads meta/sync (readSyncConsent)", { who: OWNER, method: "get", path: "users/owner-1/meta/sync", existing: { enabled: true } }),
  allow("L-U9", "owner deletes the tombstone book (deleteCloudCopy)", { who: OWNER, method: "delete", path: "users/owner-1/meta/tombstones", existing: {} }),
  allow("L-U10", "owner writes the profile (writeProfile)", { who: OWNER, method: "create", path: "users/owner-1", data: { email: "owner@example.com", name: "Owner", seenAt: SEEN } }),
  allow("L-U11", "owner deletes the profile (deleteProfile)", { who: OWNER, method: "delete", path: "users/owner-1", existing: { email: "owner@example.com" } }),
  allow("L-U12", "owner lists own players (fetchOwnRatings)", { who: OWNER, method: "list", path: "users/owner-1/players/p1", existing: { rating: 70 } }),
  allow("L-U13", "site owner reads somebody's player (Ver como)", { who: SITE_OWNER, method: "get", path: "users/owner-1/players/p1", existing: { firstName: "Maxi" } }),
  allow("L-U14", "site owner lists the profiles (listAccounts)", { who: SITE_OWNER, method: "list", path: "users/owner-1", existing: { email: "owner@example.com" } }),
  allow("L-U15", "site owner reads every meta (listAccounts)", { who: SITE_OWNER, method: "list", path: "users/owner-1/meta/sync", existing: { enabled: true } }),
  deny("A-U8", "stranger writes the owner's roster", { who: STRANGER, method: "update", path: "users/owner-1/players/p1", data: { x: 1 }, existing: { x: 0 } }),
  deny("A-U9", "stranger reads the owner's roster", { who: STRANGER, method: "get", path: "users/owner-1/players/p1", existing: { rating: 70 } }),
  deny("A-U10", "site owner writes somebody's roster", { who: SITE_OWNER, method: "update", path: "users/owner-1/players/p1", data: { x: 1 }, existing: { x: 0 } }),
];

const POLLS: Row[] = [
  allow("L-P1", "owner sends a poll (createPoll)", { who: OWNER, method: "create", path: "polls/P2", data: { ownerUid: "owner-1", title: "Ranking", createdAt: SEEN } }),
  allow("L-P2", "owner's face in the same batch, full-size photo (createPoll)", { who: OWNER, method: "create", path: "polls/P2/players/p1", data: face("owner-1", BIG_AVATAR), after: { "polls/P2": poll } }),
  allow("L-P3", "owner's face with no photo (createPoll)", { who: OWNER, method: "create", path: "polls/P2/players/p2", data: face("owner-1", ""), after: { "polls/P2": poll } }),
  allow("L-P3b", "owner's face with a percent-encoded photo out of a hand-edited backup (createPoll)", { who: OWNER, method: "create", path: "polls/P2/players/p3", data: face("owner-1", "data:image/svg+xml,%3Csvg%3E%3C/svg%3E"), after: { "polls/P2": poll } }),
  allow("L-P4", "owner lists own polls (listMyPolls)", { who: OWNER, method: "list", path: "polls/P1", existing: poll }),
  allow("L-P5", "owner sets a ballot aside (setIgnoredBallots)", { who: OWNER, method: "update", path: "polls/P1", data: { ...poll, ignored: ["pb9"] }, existing: poll }),
  allow("L-P6", "owner reads the pile (fetchBallotEntries)", { who: OWNER, method: "list", path: "polls/P1/ballots/pb1", existing: { votes: {} } }),
  allow("L-P7", "owner deletes own face (deletePoll)", { who: OWNER, method: "delete", path: "polls/P1/players/p1", existing: face("owner-1") }),
  allow("L-P8", "owner deletes a ballot (deletePoll)", { who: OWNER, method: "delete", path: "polls/P1/ballots/pb1", existing: { votes: {} } }),
  allow("L-P9", "owner deletes an identity blind (deletePoll)", { who: OWNER, method: "delete", path: "polls/P1/identities/pb1", existing: { email: "voter@example.com" } }),
  allow("L-P10", "owner deletes the poll (deletePoll)", { who: OWNER, method: "delete", path: "polls/P1", existing: poll }),
  allow("L-P12", "voter reads the poll (fetchPoll)", { who: VOTER, method: "get", path: "polls/P1", existing: poll }),
  allow("L-P13", "voter lists the faces (fetchPoll)", { who: VOTER, method: "list", path: "polls/P1/players/p1", existing: face("owner-1") }),
  allow("L-P14", "voter reads own marker (claimBallotId / fetchMyBallotId)", { who: VOTER, method: "get", path: "polls/P1/voters/voter-1", existing: { ballotId: "pb1" } }),
  allow("L-P15", "voter claims a fresh ballot id (claimBallotId)", { who: VOTER, method: "create", path: "polls/P2/voters/voter-1", data: { ballotId: "pb-fresh" } }),
  allow("L-P16", "voter claims a UUID like generateId makes", { who: VOTER, method: "create", path: "polls/P2/voters/voter-1", data: { ballotId: "3f1c2a9e-8b7d-4c6e-9a1b-0d2e3f4a5b6c" }, world: { ...W, "polls/P2/ballots/3f1c2a9e-8b7d-4c6e-9a1b-0d2e3f4a5b6c": null } }),
  allow("L-P16b", "voter claims an id from generateId's fallback (two base-36 runs)", { who: VOTER, method: "create", path: "polls/P2/voters/voter-1", data: { ballotId: "mfx3k2a1-9q8w7e6r" }, world: { ...W, "polls/P2/ballots/mfx3k2a1-9q8w7e6r": null } }),
  allow("L-P17", "voter sends the ballot its marker names (submitBallot)", { who: VOTER, method: "create", path: "polls/P1/ballots/pb1", data: { votes: { p1: { played: true, overall: 70, scale: 100, roleRatings: {}, attributes: {} } } } }),
  allow("L-P18", "voter rewrites it (submitBallot)", { who: VOTER, method: "update", path: "polls/P1/ballots/pb1", data: { votes: { p1: { overall: 60 } } }, existing: { votes: {} } }),
  allow("L-P19", "voter reads it back (fetchBallot)", { who: VOTER, method: "get", path: "polls/P1/ballots/pb1", existing: { votes: {} } }),
  allow("L-P20", "voter files who sent it (submitBallot)", { who: VOTER, method: "create", path: "polls/P1/identities/pb1", data: { email: "voter@example.com", name: "Voter", at: SEEN } }),
  allow("L-P21", "the other super admin lists who sent which (fetchIdentities)", { who: OTHER_ADMIN, method: "list", path: "polls/P1/identities/pb1", existing: { email: "voter@example.com" } }),
  allow("L-P22", "site owner lists somebody's polls (Ver como)", { who: SITE_OWNER, method: "list", path: "polls/P1", existing: poll }),
  allow("L-P23", "site owner reads somebody's pile (Ver como)", { who: SITE_OWNER, method: "list", path: "polls/P1/ballots/pb1", existing: { votes: {} } }),
  allow("L-P24", "somebody with no vote here looks for a marker (fetchMyBallotId)", { who: STRANGER, method: "get", path: "polls/P1/voters/stranger" }),
  deny("A-P14", "a poll in somebody else's name", { who: STRANGER, method: "create", path: "polls/P2", data: { ownerUid: "owner-1", title: "x", createdAt: SEEN } }),
  deny("A-P15", "owner hands the poll to somebody else", { who: OWNER, method: "update", path: "polls/P1", data: { ...poll, ownerUid: "x" }, existing: poll }),
  deny("A-P17", "a ballot at an id the voter's marker does not name", { who: VOTER, method: "create", path: "polls/P1/ballots/pb2", data: { votes: {} }, world: { ...W, "polls/P1/ballots/pb2": null } }),
  deny("A-P18", "a ballot with no marker at all", { who: STRANGER, method: "create", path: "polls/P1/ballots/pb-fresh", data: { votes: {} } }),
  deny("A-P19", "a ballot that signs itself", { who: VOTER, method: "update", path: "polls/P1/ballots/pb1", data: { votes: {}, uid: "voter-1" }, existing: { votes: {} } }),
  deny("A-P23", "a marker naming nothing", { who: STRANGER, method: "create", path: "polls/P1/voters/stranger", data: { ballotId: "" } }),
  deny("A-P24", "a marker re-pointed", { who: VOTER, method: "update", path: "polls/P1/voters/voter-1", data: { ballotId: "pb-fresh" }, existing: { ballotId: "pb1" } }),
  deny("A-P25", "a marker in somebody else's uid", { who: STRANGER, method: "create", path: "polls/P1/voters/voter-1", data: { ballotId: "pb-fresh" } }),
  deny("A-P26", "anon claims a vote", { who: ANON, method: "create", path: "polls/P1/voters/anon-x", data: { ballotId: "pb-fresh" }, world: { ...W, "polls/P1/voters/anon-x": null } }),
  deny("A-P27", "the owner walks the markers", { who: OWNER, method: "list", path: "polls/P1/voters/voter-1", existing: { ballotId: "pb1" } }),
  deny("A-P28", "a voter reads somebody else's marker", { who: STRANGER, method: "get", path: "polls/P1/voters/voter-1", existing: { ballotId: "pb1" } }),
  deny("A-P29", "a voter reads somebody else's ballot", { who: STRANGER, method: "get", path: "polls/P1/ballots/pb1", existing: { votes: {} } }),
  deny("A-P30", "the owner reads who sent which", { who: OWNER, method: "list", path: "polls/P1/identities/pb1", existing: { email: "voter@example.com" } }),
  deny("A-P31", "an identity whose address is not the token's", { who: VOTER, method: "create", path: "polls/P1/identities/pb1", data: { email: "somebody@else.com", name: "V", at: SEEN } }),
  deny("A-P32", "anon reads a poll", { who: ANON, method: "get", path: "polls/P1", existing: poll }),
  deny("A-P33", "anybody but the owner enumerates polls", { who: STRANGER, method: "list", path: "polls/P1", existing: poll }),
];

const LISTS: Row[] = [
  allow("L-L1", "owner makes a list, nothing else at that id (createList)", { who: OWNER, method: "create", path: "lists/M8", data: lst }),
  allow("L-L2", "owner makes a list beside their own tercer tiempo (createList)", { who: OWNER, method: "create", path: "lists/M7", data: lst }),
  allow("L-L3", "owner makes a list beside their own votación (createList)", { who: OWNER, method: "create", path: "lists/M4", data: lst }),
  allow("L-L4", "owner changes the cupo (updateList)", { who: OWNER, method: "update", path: "lists/M1", data: { ...lst, cap: 12 }, existing: lst }),
  allow("L-L5", "owner keeps title and date in step (updateList)", { who: OWNER, method: "update", path: "lists/M1", data: { ...lst, title: "Viernes" }, existing: lst }),
  allow("L-L6", "owner deletes the list (deleteList)", { who: OWNER, method: "delete", path: "lists/M1", existing: lst }),
  allow("L-L7", "anon reads the list (watchList)", { who: ANON, method: "get", path: "lists/M1", existing: lst }),
  allow("L-L8", "anon lists the names (watchList)", { who: ANON, method: "list", path: "lists/M1/entries/e1", existing: entry("anon-y", "Juan") }),
  allow("L-L9", "anon puts a name on (joinList)", { who: ANON, method: "create", path: "lists/M1/entries/e1", data: entry("anon-x") }),
  allow("L-L10", "the organiser's Google session puts a name on (joinList)", { who: OWNER, method: "create", path: "lists/M1/entries/e2", data: entry("owner-1") }),
  allow("L-L11", "anon renames its own (renameEntry)", { who: ANON, method: "update", path: "lists/M1/entries/e1", data: entry("anon-x", "Maxi R"), existing: entry("anon-x") }),
  allow("L-L12", "anon takes its own off (removeEntry)", { who: ANON, method: "delete", path: "lists/M1/entries/e1", existing: entry("anon-x") }),
  allow("L-L13", "owner says who a name is (setEntryPlayer)", { who: OWNER, method: "update", path: "lists/M1/entries/e1", data: { ...entry("anon-x"), playerId: "p1" }, existing: entry("anon-x") }),
  allow("L-L14", "owner unsays it (setEntryPlayer null)", { who: OWNER, method: "update", path: "lists/M1/entries/e1", data: entry("anon-x"), existing: { ...entry("anon-x"), playerId: "p1" } }),
  allow("L-L15", "owner takes anybody off (removeEntry, deleteList)", { who: OWNER, method: "delete", path: "lists/M1/entries/e1", existing: entry("anon-x") }),
  deny("A-L5", "a list in somebody else's name", { who: STRANGER, method: "create", path: "lists/M8", data: lst }),
  deny("A-L7", "anon renames somebody else's name", { who: ANON, method: "update", path: "lists/M1/entries/e2", data: entry("anon-y", "Troll"), existing: entry("anon-y", "Juan") }),
  deny("A-L8", "anon puts a name on in another device's uid", { who: ANON, method: "create", path: "lists/M1/entries/e3", data: entry("anon-y") }),
  deny("A-L9", "anon says who it is itself", { who: ANON, method: "update", path: "lists/M1/entries/e1", data: { ...entry("anon-x"), playerId: "p1" }, existing: entry("anon-x") }),
  deny("A-L10", "anon takes somebody else's name off", { who: ANON, method: "delete", path: "lists/M1/entries/e2", existing: entry("anon-y") }),
  deny("A-L11", "a cupo of 41", { who: OWNER, method: "update", path: "lists/M1", data: { ...lst, cap: 41 }, existing: lst }),
  deny("A-L12", "stranger deletes the list", { who: STRANGER, method: "delete", path: "lists/M1", existing: lst }),
  deny("A-L13", "a name with a phone's own clock", { who: ANON, method: "create", path: "lists/M1/entries/e1", data: { name: "Maxi", uid: "anon-x", at: "2026-01-01T00:00:00Z" } }),
];

const RECAPS: Row[] = [
  allow("L-R1", "owner publishes beside their own lista (publishRecap)", { who: OWNER, method: "create", path: "recaps/M5", data: recap }),
  allow("L-R2", "owner publishes with nothing else at that id (publishRecap)", { who: OWNER, method: "create", path: "recaps/M8", data: recap }),
  allow("L-R3", "owner publishes beside their own lista and votación (publishRecap)", { who: OWNER, method: "create", path: "recaps/M4", data: recap, world: { ...W, "lists/M4": lst } }),
  allow("L-R4", "owner republishes (publishRecap, merge)", { who: OWNER, method: "update", path: "recaps/M1", data: { ...recap, goalsA: 4 }, existing: recap }),
  allow("L-R5", "owner's face in the publish batch, full-size photo (publishRecap)", { who: OWNER, method: "create", path: "recaps/M8/players/p1", data: face("owner-1", BIG_AVATAR), after: { "recaps/M8": recap } }),
  allow("L-R6", "owner rewrites own face on a republish (publishRecap)", { who: OWNER, method: "update", path: "recaps/M1/players/p1", data: { ...face("owner-1"), name: "Maxi R" }, existing: face("owner-1") }),
  allow("L-R8", "owner shuts the thread (setRecapClosed)", { who: OWNER, method: "update", path: "recaps/M1", data: { ...recap, closed: true }, existing: recap }),
  allow("L-R9", "owner sets a ballot aside (setIgnoredBallots)", { who: OWNER, method: "update", path: "recaps/M1", data: { ...recap, ignored: ["rb-ignored"] }, existing: recap }),
  allow("L-R10", "owner deletes own face (deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1/players/p1", existing: face("owner-1") }),
  allow("L-R12", "owner deletes somebody's comment (deleteComment, deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1/comments/c1", existing: comment("voter-1") }),
  allow("L-R13", "owner deletes a ballot (deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  allow("L-R14", "owner lists the addresses (fetchIdentities, deleteRecap)", { who: OWNER, method: "list", path: "recaps/M1/identities/voter-1", existing: { email: "voter@example.com" } }),
  allow("L-R15", "owner deletes an address (deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1/identities/voter-1", existing: { email: "voter@example.com" } }),
  allow("L-R16", "owner takes the recap down (deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1", existing: recap }),
  allow("L-R17", "owner reads the pile (watchRecap withBallots)", { who: OWNER, method: "list", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  allow("L-R18", "anon reads the recap (watchRecap)", { who: ANON, method: "get", path: "recaps/M1", existing: recap }),
  allow("L-R19", "anon lists the faces (watchRecap)", { who: ANON, method: "list", path: "recaps/M1/players/p1", existing: face("owner-1") }),
  allow("L-R20", "anon lists the comments (watchRecap)", { who: ANON, method: "list", path: "recaps/M1/comments/c1", existing: comment("voter-1") }),
  allow("L-R21", "anon looks for its own marker on open (fetchMyRecapBallotId)", { who: ANON, method: "get", path: "recaps/M1/voters/anon-x" }),
  allow("L-R22", "voter comments (postComment)", { who: VOTER, method: "create", path: "recaps/M1/comments/c2", data: comment("voter-1") }),
  allow("L-R23", "voter files their address (writeIdentity)", { who: VOTER, method: "create", path: "recaps/M1/identities/voter-1", data: { email: "voter@example.com", name: "Voter", at: TIME } }),
  allow("L-R24", "voter takes their comment back (deleteComment)", { who: VOTER, method: "delete", path: "recaps/M1/comments/c2", existing: comment("voter-1") }),
  allow("L-R25", "voter reads own marker (fetchMyRecapBallotId)", { who: VOTER, method: "get", path: "recaps/M1/voters/voter-1", existing: { ballotId: "rb1" } }),
  allow("L-R26", "voter claims a fresh ballot id (claimRecapBallotId)", { who: STRANGER, method: "create", path: "recaps/M1/voters/stranger", data: { ballotId: "rb-fresh" } }),
  allow("L-R27", "voter claims one on a shut thread (the ballot is what gets refused)", { who: STRANGER, method: "create", path: "recaps/M1/voters/stranger", data: { ballotId: "rb-fresh" }, world: SHUT }),
  allow("L-R28", "voter sends puntajes (submitRecapBallot)", { who: VOTER, method: "create", path: "recaps/M1/ballots/rb1", data: recapBallot }),
  allow("L-R29", "voter revises them (submitRecapBallot)", { who: VOTER, method: "update", path: "recaps/M1/ballots/rb1", data: { players: { p1: { score: 60 } }, at: TIME }, existing: recapBallot }),
  allow("L-R30", "voter reads own ballot (fetchOwnRecapBallot)", { who: VOTER, method: "get", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  allow("L-R31", "voter takes own ballot back while the thread is open (deleteRecapBallot)", { who: VOTER, method: "delete", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  allow("L-R32", "a super admin lists the addresses", { who: OTHER_ADMIN, method: "list", path: "recaps/M1/identities/voter-1", existing: { email: "voter@example.com" } }),
  allow("L-R33", "site owner lists somebody's recaps (Ver como)", { who: SITE_OWNER, method: "list", path: "recaps/M1", existing: recap }),
  allow("L-R34", "site owner reads somebody's pile (Ver como)", { who: SITE_OWNER, method: "list", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  deny("A-R13", "a recap carrying a field nobody agreed to publish", { who: OWNER, method: "create", path: "recaps/M8", data: { ...recap, reviews: { p1: "no cruzó la mitad" } } }),
  deny("A-R14", "a recap in somebody else's name", { who: STRANGER, method: "create", path: "recaps/M8", data: recap }),
  deny("A-R19", "a marker re-pointed", { who: VOTER, method: "update", path: "recaps/M1/voters/voter-1", data: { ballotId: "rb-fresh" }, existing: { ballotId: "rb1" } }),
  deny("A-R20", "anon claims a ballot", { who: ANON, method: "create", path: "recaps/M1/voters/anon-x", data: { ballotId: "rb-fresh" } }),
  deny("A-R22", "voter sends puntajes on a shut thread", { who: VOTER, method: "update", path: "recaps/M1/ballots/rb1", data: recapBallot, existing: recapBallot, world: SHUT }),
  deny("A-R23", "a ballot at an id the marker does not name", { who: VOTER, method: "create", path: "recaps/M1/ballots/rb-fresh", data: recapBallot }),
  deny("A-R24", "a ballot that signs itself", { who: VOTER, method: "update", path: "recaps/M1/ballots/rb1", data: { ...recapBallot, uid: "voter-1" }, existing: recapBallot }),
  deny("A-R25", "a ballot stamped by the phone", { who: VOTER, method: "update", path: "recaps/M1/ballots/rb1", data: { players: {}, at: "2020-01-01T00:00:00Z" }, existing: recapBallot }),
  deny("A-R26", "anon lists the pile", { who: ANON, method: "list", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  deny("A-R27", "Google stranger reads a ballot by id", { who: STRANGER, method: "get", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  deny("A-R28", "the other super admin reads the pile", { who: OTHER_ADMIN, method: "list", path: "recaps/M1/ballots/rb1", existing: recapBallot }),
  deny("A-R29", "the owner walks the markers", { who: OWNER, method: "list", path: "recaps/M1/voters/voter-1", existing: { ballotId: "rb1" } }),
  deny("A-R30", "anon comments", { who: ANON, method: "create", path: "recaps/M1/comments/c3", data: comment("anon-x") }),
  deny("A-R31", "voter comments in somebody else's name", { who: VOTER, method: "create", path: "recaps/M1/comments/c3", data: comment("owner-1") }),
  deny("A-R32", "voter comments on a shut thread", { who: VOTER, method: "create", path: "recaps/M1/comments/c3", data: comment("voter-1"), world: SHUT }),
  deny("A-R33", "a comment edited", { who: VOTER, method: "update", path: "recaps/M1/comments/c2", data: { ...comment("voter-1"), text: "no lo dije" }, existing: comment("voter-1") }),
  deny("A-R34", "a comment carrying an address", { who: VOTER, method: "create", path: "recaps/M1/comments/c3", data: { ...comment("voter-1"), email: "voter@example.com" } }),
  deny("A-R35", "stranger deletes somebody's comment", { who: STRANGER, method: "delete", path: "recaps/M1/comments/c2", existing: comment("voter-1") }),
  deny("A-R36", "an address filed under somebody else's uid", { who: STRANGER, method: "create", path: "recaps/M1/identities/voter-1", data: { email: "stranger@example.com", name: "S", at: TIME } }),
  deny("A-R37", "voter lists the addresses", { who: VOTER, method: "list", path: "recaps/M1/identities/voter-1", existing: { email: "voter@example.com" } }),
];

const PICKS: Row[] = [
  allow("L-K1", "owner checks whether one is up (publishPick getDoc)", { who: OWNER, method: "get", path: "picks/M1", existing: pick }),
  allow("L-K2", "owner publishes beside their own lista (publishPick)", { who: OWNER, method: "create", path: "picks/M5", data: pick }),
  allow("L-K3", "owner publishes with nothing else at that id (publishPick)", { who: OWNER, method: "create", path: "picks/M8", data: pick }),
  allow("L-K4", "owner publishes beside their own tercer tiempo (publishPick)", { who: OWNER, method: "create", path: "picks/M7", data: pick }),
  allow("L-K5", "owner's face in the publish batch (publishPick)", { who: OWNER, method: "create", path: "picks/M8/players/p1", data: face("owner-1"), after: { "picks/M8": pick } }),
  allow("L-K6", "owner keeps title and date in step (updatePickHeading)", { who: OWNER, method: "update", path: "picks/M1", data: { ...pick, title: "Viernes" }, existing: pick }),
  allow("L-K7", "owner shuts the vote (setPickClosed)", { who: OWNER, method: "update", path: "picks/M1", data: { ...pick, closed: true }, existing: pick }),
  allow("L-K8", "owner picks the teams (choosePickOption)", { who: OWNER, method: "update", path: "picks/M1", data: { ...pick, chosen: 1, drawn: true, closed: true }, existing: pick }),
  allow("L-K9", "owner deletes own face (deletePick)", { who: OWNER, method: "delete", path: "picks/M1/players/p1", existing: face("owner-1") }),
  allow("L-K11", "owner deletes somebody's ballot (deletePick)", { who: OWNER, method: "delete", path: "picks/M1/ballots/anon-y", existing: pickBallot([0]) }),
  allow("L-K13", "owner takes the votación down (deletePick)", { who: OWNER, method: "delete", path: "picks/M1", existing: pick }),
  allow("L-K14", "owner lists own votaciones", { who: OWNER, method: "list", path: "picks/M1", existing: pick }),
  allow("L-K15", "anon reads the votación (watchPick)", { who: ANON, method: "get", path: "picks/M1", existing: pick }),
  allow("L-K16", "anon lists the faces (watchPick)", { who: ANON, method: "list", path: "picks/M1/players/p1", existing: face("owner-1") }),
  allow("L-K17", "anon lists the ballots to count them (watchPick)", { who: ANON, method: "list", path: "picks/M1/ballots/anon-y", existing: pickBallot([0]) }),
  allow("L-K24", "anon votes, filed under its uid (setMyBallot)", { who: ANON, method: "create", path: "picks/M1/ballots/anon-x", data: pickBallot([0, 1]) }),
  allow("L-K25", "anon changes its vote (setMyBallot)", { who: ANON, method: "update", path: "picks/M1/ballots/anon-x", data: pickBallot([1]), existing: pickBallot([0]) }),
  allow("L-K26", "anon takes its vote back while it is open (clearMyBallot)", { who: ANON, method: "delete", path: "picks/M1/ballots/anon-x", existing: pickBallot([0]) }),
  allow("L-K27", "site owner lists somebody's votaciones (Ver como)", { who: SITE_OWNER, method: "list", path: "picks/M1", existing: pick }),
  deny("A-K7", "owner changes the options under the ballots", { who: OWNER, method: "update", path: "picks/M1", data: { ...pick, options: [pick.options] }, existing: pick }),
  deny("A-K9", "a device votes under another device's uid", { who: ANON_Y, method: "create", path: "picks/M1/ballots/anon-x", data: pickBallot([0]) }),
  deny("A-K19", "a device changes another's vote", { who: ANON_Y, method: "update", path: "picks/M1/ballots/anon-x", data: pickBallot([1]), existing: pickBallot([0]) }),
  deny("A-K20", "a device takes another's vote down", { who: ANON_Y, method: "delete", path: "picks/M1/ballots/anon-x", existing: pickBallot([0]) }),
  deny("A-K23", "a vote on a shut votación", { who: ANON, method: "update", path: "picks/M1/ballots/anon-x", data: pickBallot([1]), existing: pickBallot([0]), world: SHUT }),
  deny("A-K24", "a ballot carrying a uid", { who: ANON, method: "update", path: "picks/M1/ballots/anon-x", data: { ...pickBallot([1]), uid: "anon-x" }, existing: pickBallot([0]) }),
  deny("A-K25", "an empty ballot", { who: ANON, method: "update", path: "picks/M1/ballots/anon-x", data: pickBallot([]), existing: pickBallot([0]) }),
  deny("A-K26", "a ballot stamped by the phone", { who: ANON, method: "update", path: "picks/M1/ballots/anon-x", data: { options: [1], at: "2020-01-01T00:00:00Z" }, existing: pickBallot([0]) }),
  deny("A-K27", "a votación with a field nobody agreed to publish", { who: OWNER, method: "create", path: "picks/M8", data: { ...pick, ratings: { p1: 77 } } }),
  deny("A-K28", "anybody but the organiser enumerates votaciones", { who: ANON, method: "list", path: "picks/M1", existing: pick }),
];

const ELSEWHERE: Row[] = [
  deny("A-X1", "a collection nobody declared", { who: OWNER, method: "create", path: "admins/owner-1", data: { admin: true } }),
  deny("A-X2", "nothing at all without a session", { who: null, method: "get", path: "recaps/M1", existing: recap }),
];

/* ------------------------------------------------------------------ */
/* The faces: the organiser's, and nobody else's.                      */
/* ------------------------------------------------------------------ */

const FACES: Row[] = [
  allow("L-F1", "owner takes down a face somebody stamped before these rules (deletePoll)", { who: OWNER, method: "delete", path: "polls/P1/players/evil", existing: face("anon-x", "") }, "DENY"),
  allow("L-F2", "owner takes back a face somebody stamped before these rules (publishRecap)", { who: OWNER, method: "update", path: "recaps/M1/players/p1", data: face("owner-1"), existing: face("anon-x", ""), after: { "recaps/M1": recap } }),
  allow("L-F3", "owner takes down a face somebody stamped before these rules (deleteRecap)", { who: OWNER, method: "delete", path: "recaps/M1/players/evil", existing: face("anon-x", "") }, "DENY"),
  allow("L-F4", "owner takes down a face somebody stamped before these rules (deletePick)", { who: OWNER, method: "delete", path: "picks/M1/players/evil", existing: face("anon-x", "") }, "DENY"),
  deny("A-F1", "anon overwrites the owner's poll face", { who: ANON, method: "update", path: "polls/P1/players/p1", data: face("anon-x"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F2", "anon swaps a face's photo for a tracking pixel", { who: ANON, method: "update", path: "polls/P1/players/p1", data: face("anon-x", "https://evil.example/px.gif"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F3", "Google stranger overwrites the owner's poll face", { who: STRANGER, method: "update", path: "polls/P1/players/p1", data: face("stranger"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F4", "voter with the link renames a poll face", { who: VOTER, method: "update", path: "polls/P1/players/p1", data: face("voter-1"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F5", "anon adds a face to the owner's poll", { who: ANON, method: "create", path: "polls/P1/players/evil", data: face("anon-x") }, "ALLOW"),
  deny("A-F6", "Google stranger adds a face to the owner's poll", { who: STRANGER, method: "create", path: "polls/P1/players/evil", data: face("stranger") }, "ALLOW"),
  deny("A-F7", "stranger deletes the owner's poll face", { who: STRANGER, method: "delete", path: "polls/P1/players/p1", existing: face("owner-1") }),
  deny("A-F8", "owner's face with a remote photo", { who: OWNER, method: "create", path: "polls/P2/players/p9", data: face("owner-1", "https://evil.example/px.gif"), after: { "polls/P2": poll } }, "ALLOW"),
  deny("A-F9", "owner's face whose photo is a page, not an image", { who: OWNER, method: "create", path: "polls/P2/players/p9", data: face("owner-1", "data:text/html;base64,PHNjcmlwdD4="), after: { "polls/P2": poll } }, "ALLOW"),
  deny("A-F10", "owner's face whose photo is a script address", { who: OWNER, method: "create", path: "polls/P2/players/p9", data: face("owner-1", "javascript:alert(1)"), after: { "polls/P2": poll } }, "ALLOW"),
  deny("A-F11", "owner's face carrying a rating", { who: OWNER, method: "create", path: "polls/P2/players/p9", data: { ...face("owner-1"), rating: 77 }, after: { "polls/P2": poll } }, "ALLOW"),
  deny("A-F12", "a face under a poll that is not there after the batch", { who: OWNER, method: "create", path: "polls/P2/players/p9", data: face("owner-1") }, "ALLOW"),
  deny("A-F13", "a Google account rewrites a face it stamped before these rules", { who: STRANGER, method: "update", path: "polls/P1/players/evil", data: face("stranger"), existing: face("stranger") }, "ALLOW"),
  deny("A-F14", "an anonymous device rewrites a face it stamped before these rules", { who: ANON, method: "update", path: "polls/P1/players/evil", data: face("anon-x"), existing: face("anon-x") }, "ALLOW"),
  deny("A-F15", "anon overwrites the owner's recap face", { who: ANON, method: "update", path: "recaps/M1/players/p1", data: face("anon-x"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F16", "anon adds a face to the owner's recap", { who: ANON, method: "create", path: "recaps/M1/players/evil", data: face("anon-x") }, "ALLOW"),
  deny("A-F17", "Google voter adds a face to the owner's recap", { who: VOTER, method: "create", path: "recaps/M1/players/evil", data: face("voter-1") }, "ALLOW"),
  deny("A-F18", "anon deletes the owner's recap face", { who: ANON, method: "delete", path: "recaps/M1/players/p1", existing: face("owner-1") }),
  deny("A-F19", "anon pre-plants faces under a recap that is not up", { who: ANON, method: "create", path: "recaps/M5/players/p1", data: face("anon-x") }, "ALLOW"),
  deny("A-F20", "owner's recap face carrying a rating", { who: OWNER, method: "create", path: "recaps/M8/players/p9", data: { ...face("owner-1"), rating: 77 }, after: { "recaps/M8": recap } }, "ALLOW"),
  deny("A-F21", "anon overwrites the organiser's votación face", { who: ANON, method: "update", path: "picks/M1/players/p1", data: face("anon-x"), existing: face("owner-1") }, "ALLOW"),
  deny("A-F22", "anon adds a face to the organiser's votación", { who: ANON, method: "create", path: "picks/M1/players/evil", data: face("anon-x") }, "ALLOW"),
  deny("A-F23", "anon deletes the organiser's votación face", { who: ANON, method: "delete", path: "picks/M1/players/p1", existing: face("owner-1") }),
];

export const ROWS: Row[] = [...ISLANDS, ...POLLS, ...LISTS, ...RECAPS, ...PICKS, ...ELSEWHERE, ...FACES];
