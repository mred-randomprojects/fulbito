import { useEffect, useMemo, useState } from "react";
import { Check, HelpCircle, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyChoices,
  initialChoices,
  type Choice,
  type PastedName,
} from "@/lib/pasteList";
import { blankPlayer, playerDisplayName, type Player, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * The pasted names, matched once at paste time, or null when the dialog is
   * shut. Matched up front rather than in here so that the roster changing
   * underneath — a sync landing — cannot redo the matching and throw away
   * the rows somebody already corrected.
   */
  rows: PastedName<PlayerId>[] | null;
  players: Player[];
  squad: PlayerId[];
  onClose: () => void;
  /** New players first, so they exist by the time they are anotados. */
  onApply: (result: { create: Player[]; anotar: PlayerId[] }) => void;
}

/**
 * The list from the grupo, one row per name, each with who the app thinks it
 * is. The decisions are `lib/pasteList.ts`'s; this shows them and takes the
 * corrections.
 */
export function PasteListDialog({ rows: open, players, squad, onClose, onApply }: Props) {
  // Kept through the close animation, so the list does not vanish mid-fade.
  const [rows, setRows] = useState<PastedName<PlayerId>[]>([]);
  const [choices, setChoices] = useState<Choice<PlayerId>[]>([]);
  useEffect(() => {
    if (open == null) return;
    setRows(open);
    setChoices(initialChoices(open));
  }, [open]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const sorted = useMemo(
    () => [...players].sort((a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b))),
    [players],
  );
  const squadSet = useMemo(() => new Set(squad), [squad]);

  const { anotar, create } = applyChoices(choices);
  const fresh = anotar.filter((id) => !squadSet.has(id)).length + create.length;

  const setChoice = (index: number, choice: Choice<PlayerId>) =>
    setChoices((current) => current.map((c, i) => (i === index ? choice : c)));

  const confirm = () => {
    onApply({ create: create.map((name) => blankPlayer(name)), anotar });
    onClose();
  };

  return (
    <Dialog open={open != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>La lista del grupo</DialogTitle>
          <DialogDescription>
            {rows.length} nombre{rows.length === 1 ? "" : "s"}. Fijate los que
            están en amarillo; el resto lo reconocimos solos.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {rows.map((row, index) => {
            const choice = choices[index];
            if (choice === undefined) return null;
            const picked = choice.kind === "player" ? playersById.get(choice.id) : undefined;
            const doubtful =
              choice.kind === "skip" ||
              (choice.kind === "player" &&
                (row.verdict !== "sure" || row.candidates[0]?.id !== choice.id)) ||
              (choice.kind === "new" && row.candidates.length > 0);
            const value =
              choice.kind === "player" ? `p:${choice.id}` : choice.kind;
            const candidateIds = new Set(row.candidates.map((c) => c.id));
            return (
              <li
                key={index}
                className={cn(
                  "space-y-1.5 rounded-lg border p-2",
                  doubtful ? "border-amber-500/50 bg-amber-500/5" : "border-border",
                )}
              >
                <div className="flex items-center gap-2 text-sm">
                  {choice.kind === "new" ? (
                    <UserPlus className="h-4 w-4 shrink-0 text-primary" />
                  ) : doubtful ? (
                    <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {row.verdict === "tied"
                      ? `${row.candidates.length} parecidos`
                      : choice.kind === "player" && picked != null && squadSet.has(picked.id)
                        ? "ya anotado"
                        : choice.kind === "skip"
                          ? "afuera"
                          : ""}
                  </span>
                </div>
                <select
                  value={value}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "skip") setChoice(index, { kind: "skip" });
                    else if (next === "new") setChoice(index, { kind: "new", name: row.name });
                    else setChoice(index, { kind: "player", id: next.slice(2) as PlayerId });
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={`Quién es ${row.name}`}
                >
                  {row.candidates.length > 0 && (
                    <optgroup label="Se parece a">
                      {row.candidates.map((candidate) => {
                        const player = playersById.get(candidate.id);
                        return player == null ? null : (
                          <option key={candidate.id} value={`p:${candidate.id}`}>
                            {playerDisplayName(player)}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  <optgroup label="Otra cosa">
                    <option value="new">Cargar a alguien nuevo</option>
                    <option value="skip">No anotarlo</option>
                  </optgroup>
                  <optgroup label="Todo el plantel">
                    {sorted
                      .filter((player) => !candidateIds.has(player.id))
                      .map((player) => (
                        <option key={player.id} value={`p:${player.id}`}>
                          {playerDisplayName(player)}
                        </option>
                      ))}
                  </optgroup>
                </select>
                {choice.kind === "new" && (
                  <Input
                    value={choice.name}
                    onChange={(e) => setChoice(index, { kind: "new", name: e.target.value })}
                    placeholder="Nombre"
                    aria-label={`Nombre nuevo para ${row.name}`}
                    className="h-9"
                  />
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={confirm} disabled={fresh === 0}>
            {fresh === 0
              ? "No hay nadie para sumar"
              : `Anotar ${fresh}${create.length > 0 ? ` (${create.length} nuevo${create.length === 1 ? "" : "s"})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
