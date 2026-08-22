import { useRef, useState } from "react";
import { Camera, ChevronDown, Loader2, Trash2, X } from "lucide-react";
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
import { fileToAvatar, ImageError } from "@/lib/image";
import { effectiveRating } from "@/lib/rating";
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
  newPlayerId,
  type AttributeKey,
  type Foot,
  type Player,
  type Role,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined when creating someone new. */
  player?: Player;
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
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

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
export function PlayerForm({ open, onOpenChange, player, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<Player>(() => player ?? blankPlayer());
  const [showRoles, setShowRoles] = useState(
    () => Object.keys(player?.roleRatings ?? {}).length > 0,
  );
  const [showAttributes, setShowAttributes] = useState(
    () => Object.keys(player?.attributes ?? {}).length > 0,
  );
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isNew = player === undefined;

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
      setImageError(null);
    }
  }

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

  const handleFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setUploading(true);
    setImageError(null);
    try {
      update({ avatar: await fileToAvatar(file) });
    } catch (e) {
      setImageError(
        e instanceof ImageError ? e.message : "No se pudo procesar esa foto.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current != null) fileInput.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const named =
      draft.firstName.trim() !== "" ||
      draft.lastName.trim() !== "" ||
      draft.nickname.trim() !== "";
    if (!named) return;
    onSave({ ...draft, rating: clampRating(draft.rating) });
    onOpenChange(false);
  };

  const roleCount = Object.keys(draft.roleRatings).length;
  const attributeCount = Object.keys(draft.attributes).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Jugador nuevo" : "Editar jugador"}</DialogTitle>
          <DialogDescription>
            Con el nombre y un nivel general ya está. El resto es opcional:
            llenalo solo para los que tenés bien claro cómo juegan.
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
                Se recorta cuadrada y se achica sola. Mandale la foto de la
                cámara sin drama.
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
              onChange={(e) => void handleFile(e.target.files?.[0])}
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

          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <RatingControl
              label="Nivel general"
              hint={`El único número del que no se puede zafar. ${describeOverall(draft.rating)}`}
              value={draft.rating}
              onChange={(value) => update({ rating: value ?? 6 })}
            />
            <ScaleLegend />
          </div>

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
              más que una lista entera inventada.
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

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas</Label>
            <Input
              id="notes"
              value={draft.notes}
              placeholder="Anda con la rodilla, siempre llega tarde, solo juega por izquierda…"
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            {!isNew && onDelete != null && player != null && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  onDelete(player);
                  onOpenChange(false);
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Borrar
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">{isNew ? "Agregar" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
