import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  HeartCrack,
  ImageDown,
  Loader2,
  Minus,
  Plus,
  Scale,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerForm } from "./PlayerForm";
import { usePlayerFormTarget } from "@/usePlayerFormTarget";
import { useLongPress } from "@/useLongPress";
import { SquadPicker, type LockTarget } from "./SquadPicker";
import { useTagFilter } from "@/useTagFilter";
import { SplitError } from "@/lib/balance";
import {
  findGroupSplits,
  MAX_TEAMS,
  scoreGrouping,
  splitSizes,
  swapPlayers,
  type GroupSplitOption,
  type GroupSplitResult,
  type GroupTeam,
} from "@/lib/groups";
import { buildAvoidIndex, conflictsWithin, EMPTY_AVOID_INDEX } from "@/lib/avoid";
import { defaultFormation, type Formation } from "@/lib/formations";
import {
  buildFixture,
  fixtureLines,
  summariseShape,
  type Fixture,
  type TournamentFormat,
} from "@/lib/tournament";
import { renderTournamentImage } from "@/lib/tournamentImage";
import { todayIso } from "@/lib/dates";
import { SPLIT_VERDICT_LABEL, verdictFor } from "@/lib/insights";
import { computeStats } from "@/lib/stats";
import {
  ROLE_SHORT,
  playerDisplayName,
  playerShortName,
  type BalanceBasis,
  type Match,
  type Player,
  type PlayerId,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  players: Player[];
  /** Every match, only to guess who is probably playing again tonight. */
  matches: Match[];
  onSavePlayer: (player: Player) => void;
  onDeletePlayer: (id: PlayerId) => void;
}

/**
 * Repartir: one squad, several teams.
 *
 * The match screen is built around a game — two sides, a pitch, a scoreline,
 * and a record that comes out of it. Twenty people sharing a pitch for two
 * hours, rotating off on every goal, is not that. There is no single result to
 * write down and no arrangement of four teams that a pitch can draw, so this is
 * a tool rather than a saved thing: pick who came, say how many teams, and take
 * the answer to the group chat.
 *
 * Nothing here is written to storage, deliberately. What comes out is a message
 * you paste, which is where the teams were always going to end up anyway.
 */
export function SplitPage({ players, matches, onSavePlayer, onDeletePlayer }: Props) {
  const [setup, setSetup] = useState(() => {
    const squad = lastNightsSquad(players, matches);
    const teams = suggestTeamCount(squad.length);
    return { squad, teams, sizes: splitSizes(squad.length, teams) };
  });
  const [pins, setPins] = useState<Partial<Record<PlayerId, number>>>({});
  const [basis, setBasis] = useState<BalanceBasis>("total");
  const [respectAvoids, setRespectAvoids] = useState(true);
  const [includeRatings, setIncludeRatings] = useState(false);

  // The torneito. It hangs off the split rather than living on its own screen:
  // the fixture depends on nothing but how many teams there are, so flipping
  // the format costs nothing, and re-rolling the split leaves it alone.
  const [format, setFormat] = useState<TournamentFormat>("round-robin");
  const [rule, setRule] = useState("");
  // Kept even for teams that stop existing, so going 4 → 3 → 4 brings the
  // names back rather than making somebody retype them.
  const [names, setNames] = useState<Record<number, string>>({});
  const [rendering, setRendering] = useState(false);

  const [result, setResult] = useState<GroupSplitResult | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  /** Whoever is being held, waiting for somebody on another team to tap. */
  const [picked, setPicked] = useState<PlayerId | null>(null);
  /** Which options have been moved around by hand, so the app stops claiming
      they are what the search picked. */
  const [handMade, setHandMade] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = usePlayerFormTarget();

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const statsById = useMemo(() => computeStats(matches), [matches]);
  const avoidIndex = useMemo(() => buildAvoidIndex(players), [players]);
  // Named for what it narrows, because `tags` down here is already the colours
  // the teams wear.
  const squadFilter = useTagFilter(players);

  const squadPlayers = useMemo(
    () =>
      setup.squad
        .map((id) => playersById.get(id))
        .filter((p): p is Player => p !== undefined),
    [setup.squad, playersById],
  );

  const formations = useMemo(
    () => setup.sizes.map((size) => defaultFormation(size)),
    [setup.sizes],
  );

  const tags = useMemo(() => TEAM_TAGS.slice(0, setup.teams), [setup.teams]);

  /**
   * The colours, wearing whatever the user called them.
   *
   * A name that is blank or nothing but spaces falls back to "Equipo 3" rather
   * than printing an empty chip: the point of the label is telling one five
   * from another, and a nameless one does not.
   */
  const teamLabels = useMemo(
    () =>
      tags.map((tag, index) => {
        const given = (names[index] ?? "").trim();
        return { ...tag, name: given === "" ? tag.name : given };
      }),
    [tags, names],
  );

  /* ---------------------------------------------------------------- */
  /* Setup                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Forgets the last answer, and anything it complained about.
   *
   * Called by every control that feeds the search. Leaving the teams up would
   * be the worst of both worlds — a split that looks current, silently missing
   * the person who just walked in — and leaving the error up is how "fijaste 6
   * al equipo 1" stays on screen after you unpin somebody.
   */
  const invalidate = useCallback(() => {
    setResult(null);
    setError(null);
    setPicked(null);
    setHandMade(new Set());
  }, []);

  const reshape = useCallback((squad: PlayerId[], teams: number) => {
    const capped = Math.max(2, Math.min(MAX_TEAMS, squad.length, teams));
    setSetup({ squad, teams: capped, sizes: splitSizes(squad.length, capped) });
    invalidate();
    // A lock pointing at a team that just stopped existing is dropped rather
    // than silently reinterpreted as some other team.
    setPins((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([id, team]) =>
            team !== undefined && team < capped && squad.includes(id as PlayerId),
        ),
      ),
    );
  }, [invalidate]);

  const toggleSquad = useCallback(
    (id: PlayerId) => {
      const squad = setup.squad.includes(id)
        ? setup.squad.filter((entry) => entry !== id)
        : [...setup.squad, id];
      reshape(squad, setup.teams);
    },
    [setup.squad, setup.teams, reshape],
  );

  const cycleLock = useCallback(
    (id: PlayerId) => {
      setPins((current) => {
        const next = { ...current };
        const at = current[id];
        // Round the teams and back off the end: …3, 4, nowhere, 1, …
        if (at === undefined) next[id] = 0;
        else if (at + 1 < setup.teams) next[id] = at + 1;
        else delete next[id];
        return next;
      });
      invalidate();
    },
    [setup.teams, invalidate],
  );

  /**
   * Nudges one team's size and leaves the others alone.
   *
   * Same call the match screen makes: taking a player off one team to keep the
   * total pinned is baffling to watch, so the numbers move independently and
   * the app just says when they stop adding up.
   */
  const setSize = useCallback((team: number, size: number) => {
    setSetup((current) => ({
      ...current,
      sizes: current.sizes.map((existing, i) =>
        i === team ? Math.max(1, Math.min(11, size)) : existing,
      ),
    }));
    invalidate();
  }, [invalidate]);

  const evenOut = useCallback(() => {
    setSetup((current) => ({
      ...current,
      sizes: splitSizes(current.squad.length, current.teams),
    }));
    invalidate();
  }, [invalidate]);

  const lockedTo = useCallback(
    (id: PlayerId): LockTarget | null => {
      const team = pins[id];
      if (team === undefined || team >= tags.length) return null;
      return { name: tags[team].name, fill: tags[team].fill, text: tags[team].text };
    },
    [pins, tags],
  );

  /* ---------------------------------------------------------------- */
  /* The split                                                         */
  /* ---------------------------------------------------------------- */

  const headcount = setup.sizes.reduce((sum, size) => sum + size, 0);
  const mismatch = headcount - setup.squad.length;
  const sizeHint =
    mismatch > 0
      ? `Los equipos piden ${headcount} y hay ${setup.squad.length} anotados. Falta${mismatch === 1 ? "" : "n"} ${mismatch}.`
      : mismatch < 0
        ? `Sobra${mismatch === -1 ? "" : "n"} ${-mismatch}. Agrandá un equipo o sumá otro.`
        : null;

  /**
   * Runs the search synchronously, for the same reason the match screen does:
   * it costs a couple of hundred milliseconds at the sizes this is for, and
   * deferring it behind a timeout buys a spinner at the price of a button that
   * goes dead when the browser backgrounds the tab.
   */
  const repartir = useCallback(() => {
    setError(null);
    try {
      const found = findGroupSplits({
        players: squadPlayers,
        sizes: setup.sizes,
        formations,
        pins,
        basis,
        avoid: respectAvoids ? avoidIndex : EMPTY_AVOID_INDEX,
        optionCount: 6,
      });
      setResult(found);
      setOptionIndex(0);
      // A fresh search replaces every option, so an edit remembered against
      // option 2 would now be a claim about a split nobody has seen.
      setPicked(null);
      setHandMade(new Set());
    } catch (e) {
      console.error("[repartir] failed:", e);
      setError(
        e instanceof SplitError ? e.message : "Algo salió mal al repartir los equipos.",
      );
    }
  }, [squadPlayers, setup.sizes, formations, pins, basis, respectAvoids, avoidIndex]);

  const stepOption = useCallback(
    (delta: number) => {
      if (result == null || result.options.length === 0) return;
      setOptionIndex(
        (current) => (current + delta + result.options.length) % result.options.length,
      );
      setPicked(null);
    },
    [result],
  );

  const option: GroupSplitOption | null = result?.options[optionIndex] ?? null;

  /**
   * Tap somebody, tap somebody on another team, they change shirts.
   *
   * The same gesture the match screen uses, and here it earns its keep twice
   * over: it fixes the one the app got wrong, and — starting from any split and
   * moving people until the teams match the ones already picked at the cancha —
   * it is how you get the numbers for teams the app never chose. Everything
   * re-scores off `scoreGrouping`, so the totals, the worst cruce and the
   * verdict stay true to whatever is actually on screen.
   */
  const tapPlayer = useCallback(
    (team: number, id: PlayerId) => {
      if (option == null) return;
      if (picked == null) {
        setPicked(id);
        return;
      }
      if (picked === id) {
        setPicked(null);
        return;
      }
      // Two on the same team would only reorder a list nobody sees the order
      // of, so read it as changing your mind about who you picked up.
      if (option.teams[team].players.some((player) => player.id === picked)) {
        setPicked(id);
        return;
      }

      const rescored = scoreGrouping({
        teams: swapPlayers(
          option.teams.map((entry) => entry.players),
          picked,
          id,
        ),
        formations,
        basis,
        avoid: respectAvoids ? avoidIndex : EMPTY_AVOID_INDEX,
      });

      setResult((current) =>
        current == null
          ? current
          : {
              ...current,
              options: current.options.map((entry, index) =>
                index === optionIndex ? rescored : entry,
              ),
            },
      );
      setHandMade((current) => new Set(current).add(optionIndex));
      setPicked(null);
    },
    [option, picked, optionIndex, formations, basis, respectAvoids, avoidIndex],
  );

  const edited = handMade.has(optionIndex);

  const conflicts = useMemo(() => {
    if (option == null || !respectAvoids) return [];
    return option.teams.flatMap((team) =>
      conflictsWithin(
        avoidIndex,
        team.players.map((p) => p.id),
      ),
    );
  }, [option, respectAvoids, avoidIndex]);

  const nameOf = useCallback(
    (id: PlayerId): string => {
      const player = playersById.get(id);
      return player === undefined ? "Alguien" : playerShortName(player);
    },
    [playersById],
  );

  const fixture = useMemo(
    () => buildFixture(format, option?.teams.length ?? setup.teams),
    [format, option, setup.teams],
  );

  const text = useMemo(
    () =>
      option == null
        ? ""
        : buildText(option, teamLabels, formations, includeRatings, fixture, rule),
    [option, teamLabels, formations, includeRatings, fixture, rule],
  );

  const downloadImage = useCallback(async () => {
    if (option == null) return;
    setRendering(true);
    setError(null);
    try {
      const blob = await renderTournamentImage({
        date: todayIso(),
        shape: summariseShape(option.teams.map((team) => team.players.length)),
        rule: rule.trim(),
        teams: option.teams.map((team, index) => ({
          name: teamLabels[index].name,
          fill: teamLabels[index].fill,
          text: teamLabels[index].text,
          // The lineup rather than `team.players`: the order the formation
          // settled on is the order the card on screen shows, and the picture
          // has to agree with the screen it was taken from.
          players: team.evaluation.lineup.filter((p): p is Player => p != null),
          total: includeRatings ? team.evaluation.total : null,
        })),
        fixture,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "torneito.png";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[torneito] image failed:", e);
      setError("No se pudo armar la imagen. Probá de nuevo.");
    } finally {
      setRendering(false);
    }
  }, [option, teamLabels, includeRatings, fixture, rule]);

  const copy = useCallback(async () => {
    // `navigator.clipboard` is simply absent outside a secure context, so
    // reaching for `.writeText` throws before any promise exists — a bare
    // `.catch()` would never see it.
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("El navegador no dejó copiar. Seleccioná el texto y copialo a mano.");
    }
  }, [text]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const ready = setup.squad.length >= 2 && mismatch === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Repartir</h1>
        <p className="text-sm text-muted-foreground">
          Cuando son un montón y con dos equipos no alcanza. Elegí en cuántos los
          partís, se reparten parejos, y te arma el torneito para mandar al grupo.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">¿Cuántos equipos?</span>
              <Stepper
                value={setup.teams}
                min={2}
                max={Math.min(MAX_TEAMS, Math.max(2, setup.squad.length))}
                onChange={(teams) => reshape(setup.squad, teams)}
                label="equipos"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  De a cuántos van
                </span>
                <button
                  type="button"
                  onClick={evenOut}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Scale className="h-3 w-3" />
                  Emparejar
                </button>
              </div>
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {setup.sizes.map((size, index) => (
                  <li
                    key={tags[index].name}
                    className="flex items-center justify-between gap-1 rounded-lg border border-border px-2 py-1"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: tags[index].fill }}
                      />
                      <span className="truncate text-xs">{tags[index].name}</span>
                    </span>
                    <Stepper
                      value={size}
                      min={1}
                      max={11}
                      onChange={(next) => setSize(index, next)}
                      label={tags[index].name}
                      compact
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Comparar por</span>
                <div className="flex rounded-lg border border-border p-0.5 text-xs">
                  {(["total", "average"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setBasis(key);
                        invalidate();
                      }}
                      className={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        basis === key
                          ? "bg-secondary font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {key === "total" ? "Nivel total" : "Promedio"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={respectAvoids}
                  onChange={(e) => {
                    setRespectAvoids(e.target.checked);
                    invalidate();
                  }}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="text-xs">
                  <span className="font-medium">Respetar las malas ondas</span>
                  <span className="block text-muted-foreground">
                    Los que no se mezclan van a equipos distintos.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={repartir} disabled={!ready} className="flex-1 sm:flex-none">
              <Shuffle className="mr-1.5 h-4 w-4" />
              {result == null ? "Repartir" : "Repartir de nuevo"}
            </Button>

            {result != null && result.options.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => stepOption(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                  aria-label="Opción anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1.5 text-xs text-muted-foreground">
                  Opción {optionIndex + 1}/{result.options.length}
                </span>
                <button
                  type="button"
                  onClick={() => stepOption(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                  aria-label="Opción siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {sizeHint != null && setup.squad.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {sizeHint}
            </p>
          )}

          {error != null && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {conflicts.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <HeartCrack className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {conflicts.map(({ a, b }) => `${nameOf(a)} y ${nameOf(b)}`).join(", ")}{" "}
                quedaron juntos, y no se bancan. Con esta cantidad de equipos no
                daba para separarlos a todos.
              </span>
            </p>
          )}

          {option == null ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
              <Users className="mb-3 h-9 w-9 text-muted-foreground/60" />
              <h2 className="text-lg font-medium">¿Quiénes juegan?</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Marcá a todos los que cayeron, decí en cuántos equipos los querés
                y dale a Repartir. Si la última vez jugaron los mismos, ya están
                marcados.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Se busca que cualquier cruce sea parejo, no sólo que los totales
                den parecido: rota todo el mundo contra todo el mundo, así que el
                peor cruce de la noche es el que importa.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Después les ponés nombre a los equipos y sale el fixture, con la
                imagen lista para tirar en el grupo.
              </p>
            </div>
          ) : (
            <>
              <FairnessBar
                option={option}
                exhaustive={result?.exhaustive ?? false}
                edited={edited}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                {option.teams.map((team, index) => (
                  <TeamCard
                    key={tags[index].name}
                    tag={tags[index]}
                    team={team}
                    formation={formations[index]}
                    name={names[index] ?? ""}
                    onRename={(value) =>
                      setNames((current) => ({ ...current, [index]: value }))
                    }
                    picked={picked}
                    onPick={(id) => tapPlayer(index, id)}
                    onView={form.view}
                  />
                ))}
              </div>

              <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {picked == null
                    ? "¿No te convence? Tocá a uno y después a otro de otro equipo y se cambian de camiseta. Los números se recalculan solos — sirve también para cargar los equipos que ya armaron a mano y ver qué tan parejos quedaron. Mantené apretado a cualquiera para ver su ficha."
                    : `${nameOf(picked)} está esperando. Tocá a alguien de otro equipo para hacer el cambio, o tocalo de nuevo para soltarlo.`}
                </span>
              </p>

              <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Trophy className="h-4 w-4" />
                    El torneito
                  </span>
                  <div className="flex rounded-lg border border-border p-0.5 text-xs">
                    {FORMATS.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => setFormat(entry.key)}
                        className={cn(
                          "rounded-md px-2 py-1 transition-colors",
                          format === entry.key
                            ? "bg-secondary font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Cada partido
                  </span>
                  <input
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                    placeholder="a 2 goles, o 7 minutos"
                    maxLength={40}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                  />
                </label>

                <FixtureBoard fixture={fixture} tags={teamLabels} />
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={includeRatings}
                    onChange={(e) => setIncludeRatings(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Mandar los niveles también</span>
                    <span className="block text-xs text-muted-foreground">
                      Va apagado porque a nadie le cae bien enterarse de que es un 4.
                    </span>
                  </span>
                </label>
                <Button
                  className="w-full"
                  onClick={() => void downloadImage()}
                  disabled={rendering}
                >
                  {rendering ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageDown className="mr-1.5 h-4 w-4" />
                  )}
                  {rendering ? "Dibujando…" : "Bajar la imagen del torneito"}
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => void copy()}>
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {copied ? "Copiado" : "Copiar para WhatsApp"}
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Esto no se guarda en ningún lado. Lo que mandás al grupo es el
                  registro.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <SquadPicker
            players={players}
            squad={setup.squad}
            lockedTo={lockedTo}
            onToggle={toggleSquad}
            onCycleLock={cycleLock}
            onSelectAll={(ids) =>
              reshape(
                [...setup.squad, ...ids.filter((id) => !setup.squad.includes(id))],
                setup.teams,
              )
            }
            onClear={(ids) =>
              reshape(
                setup.squad.filter((id) => !ids.includes(id)),
                setup.teams,
              )
            }
            tagFilter={squadFilter}
            onAddPlayer={form.create}
            onViewPlayer={form.view}
          />
        </div>
      </div>

      <PlayerForm
        open={form.target != null}
        onOpenChange={(next) => {
          if (!next) form.close();
        }}
        player={
          form.target?.kind === "player"
            ? playersById.get(form.target.id)
            : undefined
        }
        roster={players}
        statsById={statsById}
        onSave={(player) => {
          onSavePlayer(player);
          // Only the nuevo flow anota. Opening a ficha to see what somebody is
          // worth must not put them in tonight's reparto.
          if (!form.wasCreating()) return;
          // The form saves itself as you type, so this runs on every keystroke:
          // anotarlo has to be idempotent or one slowly typed name lands in the
          // squad half a dozen times.
          if (setup.squad.includes(player.id)) return;
          reshape([...setup.squad, player.id], setup.teams);
        }}
        onDelete={(player) => {
          if (setup.squad.includes(player.id)) {
            reshape(
              setup.squad.filter((id) => id !== player.id),
              setup.teams,
            );
          }
          onDeletePlayer(player.id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

interface TeamTag {
  name: string;
  /** Stands in for the colour in a plain-text message. */
  emoji: string;
  fill: string;
  /** Text colour that reads on `fill`. */
  text: string;
}

/**
 * Eight teams told apart by colour.
 *
 * Not `KITS`: that vocabulary is light shirts against dark shirts, which is the
 * whole truth of a two-sided game and useless past it. These are labels on a
 * screen — nobody is bringing eight sets of bibs — so they only have to be
 * distinguishable from each other at arm's length, outdoors, on a phone.
 */
const TEAM_TAGS: TeamTag[] = [
  { name: "Equipo 1", emoji: "🔵", fill: "#5b8def", text: "#08101f" },
  { name: "Equipo 2", emoji: "🔴", fill: "#ef5f6b", text: "#1f0709" },
  { name: "Equipo 3", emoji: "🟢", fill: "#4fbf85", text: "#04150c" },
  { name: "Equipo 4", emoji: "🟡", fill: "#e5c257", text: "#1a1403" },
  { name: "Equipo 5", emoji: "🟣", fill: "#a97bef", text: "#12061f" },
  { name: "Equipo 6", emoji: "🟠", fill: "#ef9a4f", text: "#1c0f03" },
  { name: "Equipo 7", emoji: "⚪", fill: "#e8ecf2", text: "#0b1220" },
  { name: "Equipo 8", emoji: "🟤", fill: "#b07f57", text: "#180f07" },
];

/**
 * The two ways a shared cancha actually gets run.
 *
 * Neither is a special case of the other: one can be written out in full before
 * a ball is kicked, and the other cannot, because after the first match every
 * pairing depends on a result nobody has yet.
 */
const FORMATS: { key: TournamentFormat; label: string }[] = [
  { key: "round-robin", label: "Todos contra todos" },
  { key: "winner-stays", label: "El que gana se queda" },
];

/**
 * Teams of about five, which is what a shared pitch and a rotation want.
 *
 * Only ever the opening guess — the control right next to it is one tap away,
 * and every later change respects whatever the user set.
 */
function suggestTeamCount(squadSize: number): number {
  if (squadSize < 4) return 2;
  return Math.min(MAX_TEAMS, Math.max(2, Math.round(squadSize / 5)));
}

/**
 * Whoever played the last game, minus anyone since removed from the roster.
 *
 * The same fifteen people turn up week after week, and ticking them off one by
 * one on a phone at the side of a pitch is the most tedious thing this app
 * asks of anybody. It is a guess, and every one of them is one tap from wrong.
 */
function lastNightsSquad(players: Player[], matches: Match[]): PlayerId[] {
  const known = new Set(players.map((p) => p.id));
  const latest = [...matches].sort(
    (a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  return latest === undefined ? [] : latest.squad.filter((id) => known.has(id));
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  compact = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  compact?: boolean;
}) {
  const size = compact ? "h-6 w-6" : "h-8 w-8";
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Menos ${label}`}
        className={cn(
          "flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25",
          size,
        )}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className={cn("tabular text-center text-sm", compact ? "w-5" : "w-6")}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Más ${label}`}
        className={cn(
          "flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-25",
          size,
        )}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/** The one number that says whether this split is any good. */
function FairnessBar({
  option,
  exhaustive,
  edited,
}: {
  option: GroupSplitOption;
  exhaustive: boolean;
  /** True once this option has been moved around by hand. */
  edited: boolean;
}) {
  const verdict = verdictFor(option.worstGap);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-3 py-2">
      <span className="text-sm font-medium">{SPLIT_VERDICT_LABEL[verdict]}</span>
      <span className="text-xs text-muted-foreground">
        El cruce más disparejo se lleva{" "}
        <span className="tabular font-medium text-foreground">
          {option.worstGap.toFixed(2)}
        </span>{" "}
        por jugador.
      </span>
      <span className="flex-1" />
      {/* Once somebody has moved a player, the line about what the search
          managed to prove is about a split that is no longer on screen. */}
      <span className="text-[11px] text-muted-foreground">
        {edited
          ? "Estos equipos los acomodaste vos."
          : exhaustive
            ? "Se probaron todos los repartos posibles."
            : "Son demasiados repartos para probarlos todos; éste es el mejor que apareció."}
      </span>
    </div>
  );
}

/**
 * The fixture, on screen.
 *
 * Deliberately the same two shapes the image and the pasted text draw, from the
 * same `Fixture`: what somebody checks here is exactly what lands in the group
 * chat, and three renderers agreeing is only worth anything if they are reading
 * one answer rather than each working it out again.
 */
function FixtureBoard({
  fixture,
  tags,
}: {
  fixture: Fixture;
  tags: readonly TeamTag[];
}) {
  if (fixture.format === "winner-stays") {
    return (
      <div className="space-y-2">
        <SectionLabel>Arrancan</SectionLabel>
        <MatchRow tags={tags} home={fixture.opener.home} away={fixture.opener.away} />
        {fixture.queue.length > 0 && (
          <>
            <SectionLabel>Y van entrando</SectionLabel>
            <ol className="space-y-1">
              {fixture.queue.map((index, position) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                  <span className="tabular w-4 text-xs text-muted-foreground">
                    {position + 1}.
                  </span>
                  <TeamChip tag={tags[index]} index={index} />
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          El que gana se queda. El que pierde va al final de la fila.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fixture.rounds.map((round, index) => (
        <div key={index} className="space-y-1.5">
          <SectionLabel>Fecha {index + 1}</SectionLabel>
          {round.matches.map((match) => (
            <MatchRow
              key={`${match.home}-${match.away}`}
              tags={tags}
              home={match.home}
              away={match.away}
            />
          ))}
          {round.bye != null && (
            <p className="text-[11px] text-muted-foreground">
              {tags[round.bye]?.name ?? `Equipo ${round.bye + 1}`} descansa.
            </p>
          )}
        </div>
      ))}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {fixture.total} {fixture.total === 1 ? "partido" : "partidos"} en total,{" "}
        {fixture.each} para cada equipo. Se juegan en este orden, uno atrás del
        otro.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function TeamChip({ tag, index }: { tag: TeamTag | undefined; index: number }) {
  return (
    <span
      className="truncate rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        background: tag?.fill ?? "hsl(var(--secondary))",
        color: tag?.text ?? "hsl(var(--foreground))",
      }}
    >
      {tag?.name ?? `Equipo ${index + 1}`}
    </span>
  );
}

function MatchRow({
  tags,
  home,
  away,
}: {
  tags: readonly TeamTag[];
  home: number;
  away: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 flex-1 justify-end">
        <TeamChip tag={tags[home]} index={home} />
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">vs</span>
      <span className="flex min-w-0 flex-1 justify-start">
        <TeamChip tag={tags[away]} index={away} />
      </span>
    </div>
  );
}

function TeamCard({
  tag,
  team,
  formation,
  name,
  onRename,
  picked,
  onPick,
  onView,
}: {
  tag: TeamTag;
  team: GroupTeam;
  formation: Formation;
  /** Whatever the user typed, raw — empty means "still called Equipo 3". */
  name: string;
  onRename: (name: string) => void;
  /** Who is being held, anywhere on the screen. */
  picked: PlayerId | null;
  onPick: (id: PlayerId) => void;
  onView: (id: PlayerId) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: `${tag.fill}44` }}>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
        style={{ background: tag.fill, color: tag.text }}
      >
        {/* Naming the teams is the whole difference between a reparto and a
            torneito, so it is an input sitting where the name already was
            rather than a form somewhere else. */}
        <input
          value={name}
          onChange={(e) => onRename(e.target.value)}
          placeholder={tag.name}
          maxLength={22}
          aria-label={`Nombre de ${tag.name}`}
          className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:text-current placeholder:opacity-70"
          style={{ color: tag.text }}
        />
        <span className="tabular opacity-70">{team.players.length}</span>
        <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
          {team.evaluation.total.toFixed(1)}
        </span>
      </div>
      <ul className="divide-y divide-border/60 bg-card">
        {team.evaluation.lineup.map((player, slot) =>
          player == null ? null : (
            <TeamCardRow
              key={player.id}
              player={player}
              role={ROLE_SHORT[formation.slots[slot].role]}
              rating={team.evaluation.slotRatings[slot]}
              tag={tag}
              picked={picked === player.id}
              onPick={() => onPick(player.id)}
              onView={() => onView(player.id)}
            />
          ),
        )}
      </ul>
    </div>
  );
}

/**
 * One name inside a team card. Its own component so it can hold a
 * `useLongPress`: the tap here is already the swap between two teams.
 */
function TeamCardRow({
  player,
  role,
  rating,
  tag,
  picked,
  onPick,
  onView,
}: {
  player: Player;
  role: string;
  rating: number;
  tag: TeamTag;
  picked: boolean;
  onPick: () => void;
  onView: () => void;
}) {
  const press = useLongPress({ onClick: onPick, onLongPress: onView });

  return (
    <li>
      <button
        {...press}
        type="button"
        aria-pressed={picked}
        title={`${playerShortName(player)} — mantené apretado para ver su ficha`}
        className={cn(
          press.className,
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50",
          picked && "bg-accent",
        )}
      >
        <PlayerAvatar
          player={player}
          size={26}
          // The team colour normally, and something that reads against every
          // one of the eight while held.
          ring={picked ? "hsl(var(--foreground))" : tag.fill}
          ringWidth={picked ? 3 : 2}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {playerShortName(player)}
        </span>
        <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
          {role}
        </span>
        <span className="tabular w-7 text-right text-xs font-medium text-muted-foreground">
          {rating.toFixed(1)}
        </span>
      </button>
    </li>
  );
}

/** Plain text, formatted for a group chat rather than for a spreadsheet. */
function buildText(
  option: GroupSplitOption,
  tags: readonly TeamTag[],
  formations: readonly Formation[],
  includeRatings: boolean,
  fixture: Fixture,
  rule: string,
): string {
  const lines: string[] = [
    `⚽ ${summariseShape(option.teams.map((team) => team.players.length))}`,
    "",
  ];

  option.teams.forEach((team, index) => {
    lines.push(
      `${tags[index].emoji} ${tags[index].name} (${team.players.length})${
        includeRatings ? ` — ${team.evaluation.total.toFixed(1)}` : ""
      }`,
    );
    team.evaluation.lineup.forEach((player, slot) => {
      if (player == null) return;
      // Who is in goal is the one bit of shape worth spelling out; the rest
      // gets rearranged in the first two minutes anyway.
      const marker = formations[index].slots[slot]?.role === "GK" ? "🧤" : "•";
      const rating = includeRatings
        ? ` (${team.evaluation.slotRatings[slot].toFixed(1)})`
        : "";
      lines.push(`  ${marker} ${playerDisplayName(player)}${rating}`);
    });
    lines.push("");
  });

  lines.push(
    `🏆 El torneito — ${
      fixture.format === "round-robin"
        ? "todos contra todos"
        : "el que gana se queda"
    }`,
  );
  if (rule.trim() !== "") lines.push(`⏱️ Cada partido: ${rule.trim()}`);
  lines.push("");
  lines.push(...fixtureLines(fixture, tags));

  return lines.join("\n").trimEnd();
}
