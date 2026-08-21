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
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
  { value: "both", label: "Both" },
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

  // Re-seed whenever the dialog is opened for a different player.
  const [seededFor, setSeededFor] = useState(player?.id ?? "new");
  const key = player?.id ?? "new";
  if (open && seededFor !== key) {
    setSeededFor(key);
    setDraft(player ?? blankPlayer());
    setShowRoles(Object.keys(player?.roleRatings ?? {}).length > 0);
    setShowAttributes(Object.keys(player?.attributes ?? {}).length > 0);
    setImageError(null);
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
        e instanceof ImageError ? e.message : "That photo could not be processed.",
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
          <DialogTitle>{isNew ? "New player" : "Edit player"}</DialogTitle>
          <DialogDescription>
            A name and an overall rating is all it takes. Everything below that
            is optional — fill it in only for the players you actually have an
            opinion about.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Upload photo"
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
                  {uploading ? "Processing…" : draft.avatar === "" ? "Add photo" : "Replace"}
                </Button>
                {draft.avatar !== "" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => update({ avatar: "" })}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Cropped square and shrunk automatically — a full-size camera
                photo is fine.
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
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={draft.firstName}
                autoFocus={isNew}
                onChange={(e) => update({ firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={draft.lastName}
                onChange={(e) => update({ lastName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                value={draft.nickname}
                placeholder="What people shout"
                onChange={(e) => update({ nickname: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Strong foot</Label>
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
              label="Overall rating"
              hint="The one number the whole app falls back on. Roughly: 1 is a beginner, 5 is a solid regular, 9 plus is the person everyone wants on their side."
              value={draft.rating}
              onChange={(value) => update({ rating: value ?? 6 })}
            />
          </div>

          <Disclosure
            open={showRoles}
            onToggle={() => setShowRoles((v) => !v)}
            title="Position ratings"
            summary={
              roleCount === 0
                ? "Optional — for specialists"
                : `${roleCount} set`
            }
          >
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Only for players who are genuinely different in a given position —
              a 6 outfield who is a 9 in goal. Anything left blank falls back to
              the overall rating, so there is no penalty for skipping it.
            </p>
            <div className="space-y-4">
              {ROLES.map((role) => (
                <RatingControl
                  key={role}
                  label={ROLE_LABELS[role]}
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
            title="Attributes"
            summary={
              attributeCount === 0
                ? "Optional — for fine tuning"
                : `${attributeCount} of ${ATTRIBUTES.length} set`
            }
          >
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              These nudge a player up or down within a position rather than
              replacing it. Set the one or two that stand out and leave the rest
              alone — a half-filled list is worth more than a guessed one.
            </p>
            <div className="space-y-4">
              {ATTRIBUTES.map((key) => (
                <RatingControl
                  key={key}
                  label={ATTRIBUTE_LABELS[key]}
                  value={draft.attributes[key]}
                  clearable
                  onChange={(value) => setAttribute(key, value)}
                />
              ))}
            </div>
          </Disclosure>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={draft.notes}
              placeholder="Bad knee, always late, only plays left…"
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
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isNew ? "Add player" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
