import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChoices,
  initialChoices,
  looksLikeList,
  matchPastedName,
  matchWords,
  nameScore,
  parseList,
  wordSimilarity,
} from "./pasteList.js";

const WJ = "\u2060";

/** The list as WhatsApp actually hands it over, word joiners and all. */
const GRUPO = [
  "1.Chino",
  "2.Ale",
  "3.Maxi",
  "4.Corcho",
  "5.Chiche",
  "6.Toxic",
  "7.Negrito Facu",
  "8.Juli",
  "9.Tute",
  "10.agustin",
  "11.lauti",
  "12: Chen",
  `13.${WJ} ${WJ}Zahiro`,
  `14.${WJ} ${WJ}G.borri`,
  `15.${WJ} ${WJ}Sebba amigo`,
  `16.${WJ} ${WJ}Gonza`,
  `17.${WJ} ${WJ}${WJ}valen`,
  `18.${WJ} ${WJ}${WJ}Tito amigo zahiro`,
].join("\n");

interface P {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
}

const p = (id: string, firstName: string, lastName = "", nickname = ""): P => ({
  id,
  firstName,
  lastName,
  nickname,
});

test("a list from the grupo comes out as its names, numbers and invisibles gone", () => {
  assert.deepEqual(parseList(GRUPO), [
    "Chino",
    "Ale",
    "Maxi",
    "Corcho",
    "Chiche",
    "Toxic",
    "Negrito Facu",
    "Juli",
    "Tute",
    "agustin",
    "lauti",
    "Chen",
    "Zahiro",
    "G.borri",
    "Sebba amigo",
    "Gonza",
    "valen",
    "Tito amigo zahiro",
  ]);
});

test("the header, the count and the link around a numbered list are dropped", () => {
  const text = [
    "⚽ Picado — jueves 18",
    "21hs en Palermo",
    "Van 3 de 10",
    "",
    "1. Juan ✅",
    "2) Pedro 🔥",
    "3 - José",
    "",
    "Banco:",
    "Anotate acá: https://example.com/x",
  ].join("\n");
  assert.deepEqual(parseList(text), ["Juan", "Pedro", "José"]);
});

test("without numbers every line is a name, bullets off", () => {
  assert.deepEqual(parseList("- Juan\n• Pedro\n\nTincho\r\n"), ["Juan", "Pedro", "Tincho"]);
});

test("one line is a search, two are a list", () => {
  assert.equal(looksLikeList("Juan"), false);
  assert.equal(looksLikeList("Juan\n"), false);
  assert.equal(looksLikeList(`Juan\n${WJ}\n`), false);
  assert.equal(looksLikeList("Juan\nPedro"), true);
});

test("whoever an amigo is the amigo of is not who the line is about", () => {
  assert.deepEqual(matchWords("Tito amigo zahiro"), ["tito"]);
  assert.deepEqual(matchWords("Sebba amigo"), ["sebba"]);
  assert.deepEqual(matchWords("G.borri"), ["g", "borri"]);
  assert.deepEqual(matchWords("Amigo de Juan"), ["amigo", "de", "juan"]);
});

test("word similarity: exact, short for, initial, typo — and no slack on four letters", () => {
  assert.equal(wordSimilarity("facu", "facundo"), 0.9);
  assert.equal(wordSimilarity("g", "gonzalo"), 0.8);
  assert.ok(wordSimilarity("sebba", "seba") >= 0.75);
  assert.equal(wordSimilarity("maxi", "mati"), 0);
  assert.equal(wordSimilarity("chino", "chiche"), 0);
  assert.equal(wordSimilarity("al", "alejandro"), 0);
});

test("accents and case do not matter", () => {
  assert.equal(nameScore("agustin", p("1", "Agustín")), 1);
  assert.equal(nameScore("LAUTI", p("1", "Lautaro", "", "Lauti")), 1);
});

test("a bare initial matches nobody", () => {
  assert.equal(nameScore("G.", p("1", "Gonzalo", "Borri")), 0);
});

test("an exact nickname is sure even with an Alejandro around", () => {
  const players = [p("ale", "Alejandra", "", "Ale"), p("alejo", "Alejandro", "Paz")];
  const row = matchPastedName("Ale", players);
  assert.equal(row.verdict, "sure");
  assert.equal(row.candidates[0].id, "ale");
});

test("a short form is likely, not sure", () => {
  const row = matchPastedName("Facu", [p("f", "Facundo", "Gómez")]);
  assert.equal(row.verdict, "likely");
  assert.equal(row.candidates[0].id, "f");
});

test("two people answering to it is a tie, and nobody is picked", () => {
  const players = [p("a", "Julián"), p("b", "Julieta")];
  const row = matchPastedName("Juli", players);
  assert.equal(row.verdict, "tied");
  assert.equal(row.candidates.length, 2);
  assert.deepEqual(initialChoices([row]), [{ kind: "skip" }]);
});

test("the initial settles which brother", () => {
  const players = [p("g", "Gonzalo", "Borri"), p("pe", "Pedro", "Borri")];
  const row = matchPastedName("G.borri", players);
  assert.notEqual(row.verdict, "tied");
  assert.equal(row.candidates[0].id, "g");
});

test("Tito amigo de Zahiro is not Zahiro", () => {
  const players = [p("z", "Zahiro"), p("t", "Tito")];
  assert.equal(matchPastedName("Tito amigo zahiro", players).candidates[0].id, "t");
  assert.equal(matchPastedName("Tito amigo zahiro", [p("z", "Zahiro")]).verdict, "new");
});

test("a nickname plus a name: the nickname wins", () => {
  const players = [p("n", "Facundo", "Ruiz", "Negrito"), p("f", "Facundo", "Gómez")];
  const row = matchPastedName("Negrito Facu", players);
  assert.equal(row.candidates[0].id, "n");
  assert.equal(row.verdict, "sure");
});

test("nobody like it is new", () => {
  const row = matchPastedName("Corcho", [p("1", "Juan"), p("2", "Pedro")]);
  assert.equal(row.verdict, "new");
  assert.deepEqual(initialChoices([row]), [{ kind: "new", name: "Corcho" }]);
});

test("the same player picked twice: the better line keeps them", () => {
  const players = [p("m", "Maximiliano", "", "Maxi")];
  const rows = [matchPastedName("Maxi R", players), matchPastedName("Maxi", players)];
  assert.deepEqual(initialChoices(rows), [{ kind: "skip" }, { kind: "player", id: "m" }]);
});

test("applying: players once each in order, new names tidied, blank ones dropped", () => {
  assert.deepEqual(
    applyChoices([
      { kind: "player", id: "a" },
      { kind: "new", name: "  Corcho  " },
      { kind: "skip" },
      { kind: "player", id: "a" },
      { kind: "new", name: "   " },
      { kind: "player", id: "b" },
    ]),
    { anotar: ["a", "b"], create: ["Corcho"] },
  );
});

test("the whole grupo list against a plantel", () => {
  const players = [
    p("chino", "Martín", "Lee", "Chino"),
    p("ale", "Alejandro", "Paz"),
    p("maxi", "Maximiliano", "Redigonda", "Maxi"),
    p("juli", "Julián", "Sosa"),
    p("agus", "Agustín", "Pérez"),
    p("seba", "Sebastián", "", "Seba"),
    p("borri", "Gonzalo", "Borri"),
    p("gonza", "Gonzalo", "Ríos", "Gonza"),
  ];
  const rows = parseList(GRUPO).map((name) => matchPastedName(name, players));
  const choices = initialChoices(rows);
  const byName = new Map(rows.map((row, i) => [row.name, choices[i]]));
  assert.deepEqual(byName.get("Chino"), { kind: "player", id: "chino" });
  assert.deepEqual(byName.get("Ale"), { kind: "player", id: "ale" });
  assert.deepEqual(byName.get("Maxi"), { kind: "player", id: "maxi" });
  assert.deepEqual(byName.get("Juli"), { kind: "player", id: "juli" });
  assert.deepEqual(byName.get("agustin"), { kind: "player", id: "agus" });
  assert.deepEqual(byName.get("Sebba amigo"), { kind: "player", id: "seba" });
  assert.deepEqual(byName.get("G.borri"), { kind: "player", id: "borri" });
  assert.deepEqual(byName.get("Gonza"), { kind: "player", id: "gonza" });
  assert.deepEqual(byName.get("Corcho"), { kind: "new", name: "Corcho" });
  assert.deepEqual(byName.get("Tito amigo zahiro"), { kind: "new", name: "Tito amigo zahiro" });
});
