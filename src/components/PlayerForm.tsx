import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ClipboardPaste,
  HeartCrack,
  Loader2,
  Search,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlayerAvatar } from "./PlayerAvatar";
import { RatingControl } from "./RatingControl";
import { createAutosaver } from "@/lib/autosave";
import { browserClock } from "@/lib/browserClock";
import { pickImageType, pickPastedImage } from "@/lib/clipboard";
import { fileToAvatar, ImageError } from "@/lib/image";
import { effectiveRating } from "@/lib/rating";
import { listedBy } from "@/lib/avoid";
import {
  addTag,
  hasTag,
  removeTag,
  rosterTags,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  type TagCount,
} from "@/lib/tags";
import {
  describeRecord,
  describeStreak,
  emptyStats,
  winPercent,
  OUTCOME_LABEL,
  OUTCOME_LETTER,
  type PlayerStats,
} from "@/lib/stats";
import {
  ATTRIBUTE_RUBRICS,
  OVERALL_SCALE,
  ROLE_RUBRICS,
  describeOverall,
} from "@/lib/scales";
import {
  ATTRIBUTES,
  ATTRIBUTE_LABELS,
  ROLES,
  ROLE_LABELS,
  clampRating,
  hasName,
  newPlayerId,
  playerDisplayName,
  type AttributeKey,
  type Foot,
  type Player,
  type PlayerId,
  type Role,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined when creating someone new. */
  player?: Player;
  /** The rest of the plantel, for "no lo pongas con". */
  roster: Player[];
  /** Everybody's record, read from the matches. Missing means never played. */
  statsById: ReadonlyMap<PlayerId, PlayerStats>;
  onSave: (player: Player) => void;
  onDelete?: (player: Player) => void;
}

function blankPlayer(): Player {
  return {
    id: newPlayerId(),
    firstName: "",
    lastName: "",
    nickname: "",
    avatar: "",
    rating: 6,
    roleRatings: {},
    attributes: {},
    avoid: [],
    tags: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * How long an edit may sit in the form before it is written down. Long enough
 * that typing a name is one save rather than eight, short enough that nobody
 * loses anything worth missing if the tab dies mid-sentence.
 */
const AUTOSAVE_DELAY = 600;

const FOOT_OPTIONS: { value: Foot; label: string }[] = [
  { value: "right", label: "Derecha" },
  { value: "left", label: "Izquierda" },
  { value: "both", label: "Las dos" },
];

/**
 * Create/edit a player.
 *
 * Structured as three tiers that the user opts into: a name and one overall
 * rating is a complete, valid player. Position ratings and attributes sit
 * behind disclosures so the common case stays a ten-second job, and the extra
 * detail is there for the two or three players you genuinely have an opinion
 * about.
 */
export function PlayerForm({
  open,
  onOpenChange,
  player,
  roster,
  statsById,
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<Player>(() => player ?? blankPlayer());
  const [showRoles, setShowRoles] = useState(
    () => Object.keys(player?.roleRatings ?? {}).length > 0,
  );
  const [showAttributes, setShowAttributes] = useState(
    () => Object.keys(player?.attributes ?? {}).length > 0,
  );
  const [showAvoid, setShowAvoid] = useState(() => (player?.avoid.length ?? 0) > 0);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isNew = player === undefined;

  /** Is there a record behind this draft yet? Drives the footer and Borrar. */
  const [saved, setSaved] = useState(() => open && player !== undefined);

  /**
   * `onSave` through a ref, because the autosaver outlives any one render and
   * MatchBuilder passes a fresh closure every time. Reading it at write time
   * rather than capturing it at creation time is what keeps a save from being
   * applied to a stale match.
   */
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  /**
   * The save button, made unnecessary.
   *
   * Created once and kept for the life of the component — the dialog stays
   * mounted while closed, and `reset` re-points it at whoever is being edited
   * next. See `@/lib/autosave` for the two rules it enforces.
   */
  const [autosave] = useState(() => {
    const saver = createAutosaver<Player>({
      delay: AUTOSAVE_DELAY,
      clock: browserClock,
      worthSaving: hasName,
      save: (value) => {
        onSaveRef.current({ ...value, rating: clampRating(value.rating) });
        setSaved(true);
      },
    });
    saver.reset(open && player !== undefined);
    return saver;
  });

  /**
   * Re-seed every time the dialog opens, not only when it opens for a
   * different player.
   *
   * The draft outlives the dialog, because the form stays mounted while
   * closed. Keying the re-seed on the player alone meant "someone nuevo"
   * twice in a row reused the first one's draft — same generated id and all —
   * so the second save quietly edited the first player instead of adding a
   * second one.
   */
  const key = player?.id ?? "new";
  const [seededFor, setSeededFor] = useState<string | null>(open ? key : null);
  if (open ? seededFor !== key : seededFor !== null) {
    setSeededFor(open ? key : null);
    if (open) {
      setDraft(player ?? blankPlayer());
      setShowRoles(Object.keys(player?.roleRatings ?? {}).length > 0);
      setShowAttributes(Object.keys(player?.attributes ?? {}).length > 0);
      setShowAvoid((player?.avoid.length ?? 0) > 0);
      setImageError(null);
      // Someone else is on screen now: drop anything still queued for the last
      // one, and remember whether this one is already in the roster.
      setSaved(player !== undefined);
      autosave.reset(player !== undefined);
    }
  }

  /**
   * Every edit, on its way to disk.
   *
   * The freshly seeded draft is skipped deliberately: it is the stored player,
   * object for object, and writing it back would restamp `updatedAt` — the
   * field a backup merge sorts on — for the crime of opening the dialog.
   */
  useEffect(() => {
    if (!open) return;
    if (draft === player) return;
    autosave.push(draft);
  }, [draft, open, player, autosave]);

  /**
   * Closing is the deadline. Every way out of this dialog goes through
   * `open` — the button, Escape, the X, a click on the overlay — so this is
   * the one place that catches all of them.
   */
  useEffect(() => {
    if (!open) autosave.flush();
  }, [open, autosave]);

  /** And navigating away with it still open is a deadline too. */
  useEffect(() => () => autosave.flush(), [autosave]);

  const update = (patch: Partial<Player>) => setDraft((prev) => ({ ...prev, ...patch }));

  const setRoleRating = (role: Role, value: number | undefined) => {
    setDraft((prev) => {
      const roleRatings = { ...prev.roleRatings };
      if (value === undefined) delete roleRatings[role];
      else roleRatings[role] = value;
      return { ...prev, roleRatings };
    });
  };

  const setAttribute = (key: AttributeKey, value: number | undefined) => {
    setDraft((prev) => {
      const attributes = { ...prev.attributes };
      if (value === undefined) delete attributes[key];
      else attributes[key] = value;
      return { ...prev, attributes };
    });
  };

  const handleImage = async (image: Blob | undefined) => {
    if (image === undefined) return;
    setUploading(true);
    setImageError(null);
    try {
      update({ avatar: await fileToAvatar(image) });
    } catch (e) {
      setImageError(
        e instanceof ImageError ? e.message : "No se pudo procesar esa foto.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current != null) fileInput.current.value = "";
    }
  };

  /**
   * Ctrl/⌘+V anywhere in the dialog.
   *
   * Most of these photos start life as a screenshot or a picture someone just
   * sent, so a paste saves a round trip through the filesystem. The one place
   * it has to keep its hands off is a text box holding real text — see
   * `pickPastedImage`.
   */
  const handlePaste = (e: React.ClipboardEvent) => {
    if (uploading) return;
    // Array.from, not the list itself: DataTransferItemList is only iterable
    // by way of its indexed getter, and getAsFile() has to be called now,
    // inside the handler, because the items go stale the moment it returns.
    const image = pickPastedImage(
      Array.from(e.clipboardData.items),
      isTextField(e.target),
    );
    if (image === null) return;
    e.preventDefault();
    void handleImage(image);
  };

  /**
   * The same thing from a button, for touch keyboards and anyone who does not
   * think to try the shortcut. Reading the clipboard is the part browsers
   * disagree about — Firefox has no `read()` at all — so when it goes wrong we
   * point back at the shortcut, which always works.
   */
  const pasteFromClipboard = async () => {
    setImageError(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = pickImageType(item.types);
        if (type === null) continue;
        await handleImage(await item.getType(type));
        return;
      }
      setImageError("No hay ninguna imagen en el portapapeles.");
    } catch {
      setImageError("No nos dejaron mirar el portapapeles. Pegala con Ctrl/⌘+V.");
    }
  };

  const canReadClipboard = typeof navigator.clipboard?.read === "function";

  /**
   * There is nothing left to submit — the draft has been going to disk all
   * along. Enter and the button now just mean "I'm done looking at this".
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    autosave.flush();
    onOpenChange(false);
  };

  const toggleAvoid = (id: PlayerId) => {
    setDraft((prev) => ({
      ...prev,
      avoid: prev.avoid.includes(id)
        ? prev.avoid.filter((entry) => entry !== id)
        : [...prev.avoid, id],
    }));
  };

  const addTagToDraft = (raw: string) =>
    setDraft((prev) => ({ ...prev, tags: addTag(prev.tags, raw) }));

  const removeTagFromDraft = (raw: string) =>
    setDraft((prev) => ({ ...prev, tags: removeTag(prev.tags, raw) }));

  // What the rest of the plantel already calls its groups, minus whatever this
  // player carries already. Offering them first is the only thing keeping
  // "Laburo" and "laburo" and "el laburo" from becoming three groups.
  const tagSuggestions = rosterTags(roster).filter(
    (tag) => !hasTag(draft.tags, tag.key),
  );

  const roleCount = Object.keys(draft.roleRatings).length;
  const attributeCount = Object.keys(draft.attributes).length;

  const others = roster.filter((p) => p.id !== draft.id);
  // Read off the draft, not off the stored player: the count in the disclosure
  // header has to move on the same tap that ticks the box. Entries pointing at
  // somebody since deleted are left out of the count, because there is no box
  // left on screen for them and a header promising a cruce nobody can find is
  // worse than a header that is quietly one short.
  const listedByOthers = listedBy(others, draft);
  const inRoster = new Set(others.map((p) => p.id));
  const avoidCount =
    draft.avoid.filter((id) => inRoster.has(id)).length + listedByOthers.length;
  const stats = statsById.get(draft.id) ?? emptyStats();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>{isNew ? "Jugador nuevo" : "Editar jugador"}</DialogTitle>
          <DialogDescription>
            Con el nombre y un nivel general ya está. El resto es opcional:
            llenalo solo para los que tenés bien claro cómo juegan. Se va
            guardando solo mientras escribís.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Subir foto"
            >
              <PlayerAvatar player={draft} size={76} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
              </span>
            </button>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Achicando…" : draft.avatar === "" ? "Subir foto" : "Cambiar"}
                </Button>
                {canReadClipboard && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void pasteFromClipboard()}
                    disabled={uploading}
                  >
                    <ClipboardPaste className="mr-1 h-3.5 w-3.5" />
                    Pegar
                  </Button>
                )}
                {draft.avatar !== "" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => update({ avatar: "" })}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Borrar foto
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Subila, o pegá con Ctrl/⌘+V la que tengas copiada. Se recorta
                cuadrada y se achica sola, así que mandale la de la cámara sin
                drama.
              </p>
              {imageError != null && (
                <p className="text-xs text-destructive">{imageError}</p>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleImage(e.target.files?.[0])}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Nombre</Label>
              <Input
                id="firstName"
                value={draft.firstName}
                autoFocus={isNew}
                onChange={(e) => update({ firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Apellido</Label>
              <Input
                id="lastName"
                value={draft.lastName}
                onChange={(e) => update({ lastName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nickname">Apodo</Label>
              <Input
                id="nickname"
                value={draft.nickname}
                placeholder="Como le gritan"
                onChange={(e) => update({ nickname: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pierna hábil</Label>
              <div className="flex gap-1">
                {FOOT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      update({
                        foot: draft.foot === option.value ? undefined : option.value,
                      })
                    }
                    className={cn(
                      "h-10 flex-1 rounded-md border text-xs font-medium transition-colors",
                      draft.foot === option.value
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-secondary/60 text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <TagPicker
            tags={draft.tags}
            suggestions={tagSuggestions}
            onAdd={addTagToDraft}
            onRemove={removeTagFromDraft}
          />

          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <RatingControl
              label="Nivel general"
              hint={`El único número del que no se puede zafar. ${describeOverall(draft.rating)}`}
              value={draft.rating}
              onChange={(value) => update({ rating: value ?? 6 })}
            />
            <ScaleLegend />
          </div>

          {/* What the numbers above predicted, against what actually happened.
              Read-only, and absent until there is a single finished match to
              read — an empty table of zeroes on a brand new player says
              nothing and takes up the room the form needs. */}
          {stats.played > 0 && <RecordPanel stats={stats} />}

          <Disclosure
            open={showRoles}
            onToggle={() => setShowRoles((v) => !v)}
            title="Nivel por puesto"
            summary={
              roleCount === 0
                ? "Opcional — para especialistas"
                : `${roleCount} cargado${roleCount === 1 ? "" : "s"}`
            }
          >
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Solo para los que en un puesto son otra cosa: el que en la
              cancha es un 6 pero al arco es un 9. Lo que dejes vacío usa el
              nivel general, así que saltearlo no le cuesta nada a nadie.
            </p>
            <div className="space-y-4">
              {ROLES.map((role) => (
                <RatingControl
                  key={role}
                  label={ROLE_LABELS[role]}
                  hint={`${ROLE_RUBRICS[role].what} 1 = ${ROLE_RUBRICS[role].low} · 10 = ${ROLE_RUBRICS[role].high}`}
                  value={draft.roleRatings[role]}
                  placeholderValue={effectiveRating(draft, role).value}
                  clearable
                  onChange={(value) => setRoleRating(role, value)}
                />
              ))}
            </div>
          </Disclosure>

          <Disclosure
            open={showAttributes}
            onToggle={() => setShowAttributes((v) => !v)}
            title="Atributos"
            summary={
              attributeCount === 0
                ? "Opcional — para afinar"
                : `${attributeCount} de ${ATTRIBUTES.length}`
            }
          >
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Estos lo corren un poco para arriba o para abajo dentro del
              puesto, no lo reemplazan. Poné los uno o dos que saltan a la
              vista y dejá el resto en blanco: media lista bien puesta vale
              más que una lista entera inventada. El que pega distinto es{" "}
              <em>juego en equipo</em>: al comilón le baja la gambeta, porque
              esa gambeta el equipo nunca la ve.
            </p>
            <div className="space-y-4">
              {ATTRIBUTES.map((key) => (
                <RatingControl
                  key={key}
                  label={ATTRIBUTE_LABELS[key]}
                  hint={`${ATTRIBUTE_RUBRICS[key].what} 1 = ${ATTRIBUTE_RUBRICS[key].low} · 10 = ${ATTRIBUTE_RUBRICS[key].high}`}
                  value={draft.attributes[key]}
                  clearable
                  onChange={(value) => setAttribute(key, value)}
                />
              ))}
            </div>
          </Disclosure>

          <Disclosure
            open={showAvoid}
            onToggle={() => setShowAvoid((v) => !v)}
            title="Con quién no lo pongas"
            summary={
              avoidCount === 0
                ? "Opcional — para los que no se bancan"
                : `${avoidCount} cruce${avoidCount === 1 ? "" : "s"}`
            }
          >
            <AvoidPicker
              others={others}
              selected={draft.avoid}
              listedByOthers={listedByOthers}
              onToggle={toggleAvoid}
            />
          </Disclosure>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Input
              id="notes"
              value={draft.notes}
              placeholder="Anda con la rodilla, siempre llega tarde, solo juega por izquierda…"
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>

          <DialogFooter className="items-center gap-2 pt-2">
            <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              {/* Available as soon as there is something to delete, which with
                  a form that saves itself includes a jugador nuevo who has
                  only just been given a name — the way out of a change of
                  heart used to be Cancelar, and now it is this. */}
              {onDelete != null && saved && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    // Drop the queued write first, or it would put them
                    // straight back a moment after they were removed.
                    autosave.reset(false);
                    setSaved(false);
                    onDelete(draft);
                    onOpenChange(false);
                  }}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Borrar
                </Button>
              )}
              {saved ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                  Guardado
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Poné un nombre y ya queda guardado.
                </span>
              )}
            </div>
            <Button type="submit">Listo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Would this element have swallowed the paste itself? */
function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * How it has actually gone for this player.
 *
 * Wins over matches played, and nothing cleverer. The temptation is to count a
 * draw as half a win and quote a tidier "efectividad", but the question people
 * ask out loud is how many he won out of how many he played, and answering a
 * different question with the same-looking number is how a stat stops being
 * trusted. The full G-E-P line is right there for anyone who wants the rest.
 */
function RecordPanel({ stats }: { stats: PlayerStats }) {
  const streak = describeStreak(stats);

  return (
    <div className="rounded-lg border border-border bg-secondary/25 p-3">
      <div className="flex items-center gap-3">
        <Trophy className="h-4 w-4 shrink-0 text-primary/70" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Ganó {stats.won} de {stats.played}
          </p>
          <p className="text-xs text-muted-foreground">{describeRecord(stats)}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="tabular text-lg font-semibold leading-none">
            {winPercent(stats)}%
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            ganados
          </span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-2.5 text-center">
        <Stat label="Ganados" value={stats.won} />
        <Stat label="Empates" value={stats.drawn} />
        <Stat label="Perdidos" value={stats.lost} />
        <Stat
          label="Dif. gol"
          value={`${stats.goalDifference > 0 ? "+" : ""}${stats.goalDifference}`}
        />
      </dl>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
        <span className="text-[11px] text-muted-foreground">Los últimos</span>
        <span className="flex gap-1">
          {stats.recent.map((outcome, index) => (
            <span
              key={index}
              title={OUTCOME_LABEL[outcome]}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold",
                outcome === "win"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : outcome === "draw"
                    ? "bg-secondary text-muted-foreground"
                    : "bg-destructive/20 text-destructive",
              )}
            >
              {OUTCOME_LETTER[outcome]}
            </span>
          ))}
        </span>
        {streak != null && (
          <span className="ml-auto text-[11px] text-muted-foreground">{streak}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dd className="tabular text-base font-semibold leading-none">{value}</dd>
      <dt className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
    </div>
  );
}

/**
 * The groups a player belongs to.
 *
 * Inline rather than behind a disclosure like the puestos and the atributos,
 * and for the opposite reason: those are for the two or three people you have
 * a real opinion about, while a group only earns its keep once most of the
 * plantel carries one. A tap saved thirty times over is worth the four lines
 * of room.
 */
function TagPicker({
  tags,
  suggestions,
  onAdd,
  onRemove,
}: {
  tags: string[];
  suggestions: TagCount[];
  onAdd: (raw: string) => void;
  onRemove: (raw: string) => void;
}) {
  const [entry, setEntry] = useState("");
  const full = tags.length >= MAX_TAGS;

  const commit = () => {
    if (entry.trim() === "") return;
    onAdd(entry);
    setEntry("");
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="tag">Grupos</Label>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Sacarlo de ${tag}`}
                className="rounded-full p-0.5 text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          id="tag"
          value={entry}
          maxLength={MAX_TAG_LENGTH}
          disabled={full}
          placeholder={
            full ? "Ya tiene todos los que entran" : "Laburo, barrio, los del sábado…"
          }
          onChange={(e) => setEntry(e.target.value)}
          // Enter in here means "agregá este", not "cerrá la ficha" — which is
          // what it would mean the moment the event reached the form above.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
          // And typing one, then reaching straight for Listo, means the same
          // thing. Losing it because it was still in the box would be the kind
          // of silent discard this app does not do anywhere else.
          onBlur={commit}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={commit}
          disabled={full || entry.trim() === ""}
        >
          Agregar
        </Button>
      </div>

      {!full && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Ya tenés:</span>
          {suggestions.map((tag) => (
            <button
              key={tag.key}
              type="button"
              onClick={() => onAdd(tag.label)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Para partir el plantel: el laburo, el barrio, los del sábado. Después
        filtrás por grupo y anotás a todos de una.
      </p>
    </div>
  );
}

/**
 * The people this player would rather not be on a side with.
 *
 * Ticking somebody here is enough on its own: the split reads the relation in
 * both directions, so nobody has to be told they were named, and the other
 * profile is not edited behind their back. What the other profile *does* show
 * is the bottom line here — who has named them — because being kept off
 * somebody's team without ever being able to see why would be the one genuinely
 * confusing way to build this.
 */
function AvoidPicker({
  others,
  selected,
  listedByOthers,
  onToggle,
}: {
  others: Player[];
  selected: PlayerId[];
  listedByOthers: PlayerId[];
  onToggle: (id: PlayerId) => void;
}) {
  const [query, setQuery] = useState("");

  if (others.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Todavía no hay nadie más en el plantel con quien pelearse.
      </p>
    );
  }

  const chosen = new Set(selected);
  const needle = query.trim().toLowerCase();
  const visible = others
    .filter(
      (p) =>
        needle === "" ||
        `${p.firstName} ${p.lastName} ${p.nickname}`.toLowerCase().includes(needle),
    )
    // Whoever is already ticked floats up, so the list stays readable as the
    // plantel grows and you can undo a mistake without hunting for it.
    .sort((a, b) => {
      const inA = chosen.has(a.id) ? 0 : 1;
      const inB = chosen.has(b.id) ? 0 : 1;
      if (inA !== inB) return inA - inB;
      return playerDisplayName(a).localeCompare(playerDisplayName(b));
    });

  const namesOf = (ids: PlayerId[]): string =>
    ids
      .map((id) => others.find((p) => p.id === id))
      .filter((p): p is Player => p !== undefined)
      .map(playerDisplayName)
      .join(", ");

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Para los que no se pueden ver: se pelearon, son cuñados, o simplemente
        juntos no funcionan. Marcalos acá y el reparto los va a mandar a equipos
        distintos. Alcanza con que lo diga uno de los dos — no hace falta ir a
        cargarlo del otro lado.
      </p>

      {others.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en el plantel"
            className="h-9 pl-9"
          />
        </div>
      )}

      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {visible.map((other) => {
          const picked = chosen.has(other.id);
          return (
            <li key={other.id}>
              <button
                type="button"
                onClick={() => onToggle(other.id)}
                aria-pressed={picked}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors",
                  picked ? "bg-destructive/10" : "hover:bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                    picked
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-border",
                  )}
                >
                  {picked && <HeartCrack className="h-3 w-3" />}
                </span>
                <PlayerAvatar player={other} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {playerDisplayName(other)}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="py-3 text-center text-xs text-muted-foreground">
            No hay nadie que se llame así.
          </li>
        )}
      </ul>

      {listedByOthers.length > 0 && (
        <p className="rounded-lg border border-border bg-secondary/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Además, {namesOf(listedByOthers)}{" "}
          {listedByOthers.length === 1 ? "lo tiene" : "lo tienen"} anotado a él.
          Cuenta igual, y se saca desde{" "}
          {listedByOthers.length === 1 ? "ese perfil" : "esos perfiles"}.
        </p>
      )}
    </div>
  );
}

/** The 1-10 scale, spelled out, so everyone's 7 means roughly the same thing. */
function ScaleLegend() {
  return (
    <ul className="mt-3 space-y-1 border-t border-primary/20 pt-2.5">
      {OVERALL_SCALE.map((anchor) => (
        <li key={anchor.from} className="flex gap-2 text-[11px] leading-snug">
          <span className="tabular w-8 shrink-0 font-semibold text-primary/80">
            {anchor.from}–{anchor.to}
          </span>
          <span className="text-muted-foreground">{anchor.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({
  open,
  onToggle,
  title,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/25">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
      >
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {summary}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}
