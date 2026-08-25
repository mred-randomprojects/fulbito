import { useState } from "react";
import { Check, Copy, ImageDown, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { TeamEvaluation } from "@/lib/balance";
import type { Formation } from "@/lib/formations";
import { renderLineupImage } from "@/lib/lineupImage";
import { formatMatchDate } from "@/lib/dates";
import { formatMoney, splitCourt } from "@/lib/court";
import {
  KIT_EMOJI,
  playerDisplayName,
  playerShortName,
  type Match,
  type Player,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: Match;
  /** Everyone anotado, for the line that says what the cancha cost each. */
  squad: Player[];
  evalA: TeamEvaluation;
  evalB: TeamEvaluation;
  formationA: Formation;
  formationB: Formation;
}

/**
 * Two ways out of the app, both of which land in the group chat where the game
 * was organised. No link, no account, nothing to expire.
 *
 * Ratings are excluded from both by default. The whole premise of rating your
 * friends privately is that they never find out what you put.
 */
export function ShareDialog({
  open,
  onOpenChange,
  match,
  squad,
  evalA,
  evalB,
  formationA,
  formationB,
}: Props) {
  const [includeRatings, setIncludeRatings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = buildText(match, squad, evalA, evalB, formationA, formationB, includeRatings);

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("El navegador no dejó copiar. Seleccioná el texto y copialo a mano.");
    }
  };

  const downloadImage = async () => {
    setRendering(true);
    setError(null);
    try {
      const blob = await renderLineupImage({
        match,
        formationA,
        formationB,
        lineupA: [...evalA.lineup],
        lineupB: [...evalB.lineup],
        ratingsA: evalA.slotRatings,
        ratingsB: evalB.slotRatings,
        showRatings: includeRatings,
        totalA: evalA.total,
        totalB: evalB.total,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(match.name)}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[share] image failed:", e);
      setError("No se pudo armar la imagen. Probá de nuevo.");
    } finally {
      setRendering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pasar los equipos</DialogTitle>
          <DialogDescription>
            Los niveles no van, salvo que vos digas lo contrario.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3">
          <input
            type="checkbox"
            checked={includeRatings}
            onChange={(e) => setIncludeRatings(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-sm">
            <span className="font-medium">Mostrar los niveles</span>
            <span className="block text-xs text-muted-foreground">
              Sale el número de cada uno y el total del equipo. Va apagado
              porque a nadie le cae bien enterarse de que es un 4.
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <ImageDown className="h-3.5 w-3.5" />
            La cancha, en imagen
          </Label>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void downloadImage()}
            disabled={rendering}
          >
            {rendering ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ImageDown className="mr-1.5 h-4 w-4" />
            )}
            {rendering ? "Dibujando…" : "Bajar la formación"}
          </Button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Un PNG con la cancha, las caras y los nombres. Listo para mandar al
            grupo.
          </p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            La lista, en texto
          </Label>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-relaxed">
            {text}
          </pre>
          <Button variant="secondary" className="w-full" onClick={() => void copy()}>
            {copied ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copied ? "Copiado" : "Copiar para WhatsApp"}
          </Button>
        </div>

        {error != null && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Plain text, formatted for a group chat rather than for a spreadsheet. */
function buildText(
  match: Match,
  squad: Player[],
  evalA: TeamEvaluation,
  evalB: TeamEvaluation,
  formationA: Formation,
  formationB: Formation,
  includeRatings: boolean,
): string {
  const lines: string[] = [];
  lines.push(`⚽ ${match.name}${match.date !== "" ? ` — ${formatMatchDate(match.date)}` : ""}`);
  // The scoreline goes out with the teams: the same message gets forwarded
  // again after the game, and by then this is the part people care about.
  if (match.result != null) {
    lines.push(
      `🏁 ${match.teamA.name} ${match.result.goalsA} - ${match.result.goalsB} ${match.teamB.name}`,
    );
  }
  lines.push("");

  for (const [config, evaluation, formation] of [
    [match.teamA, evalA, formationA],
    [match.teamB, evalB, formationB],
  ] as const) {
    const size = evaluation.lineup.filter((p) => p != null).length;
    lines.push(
      `${KIT_EMOJI[config.kit]} ${config.name} (${size})${
        includeRatings ? ` — ${evaluation.total.toFixed(1)}` : ""
      }`,
    );
    evaluation.lineup.forEach((player, index) => {
      if (player == null) return;
      const rating = includeRatings
        ? ` (${evaluation.slotRatings[index].toFixed(1)})`
        : "";
      // Who is in goal is the one bit of shape worth spelling out; the rest
      // gets rearranged in the first two minutes anyway.
      const marker = formation.slots[index]?.role === "GK" ? "🧤" : "•";
      lines.push(`  ${marker} ${playerDisplayName(player)}${rating}`);
    });
    lines.push("");
  }

  lines.push(...courtLines(match, squad));

  return lines.join("\n").trimEnd();
}

/**
 * What the cancha cost, and who still has not put it in.
 *
 * The chat is where the game was organised and it is where the money gets
 * chased, so the reminder rides along with the teams instead of being a
 * message somebody has to remember to write. Nothing at all until a price is
 * typed in, and the list of names only when it is shorter than the squad: a
 * "faltan" naming every single person is the line above it said twice.
 */
function courtLines(match: Match, squad: Player[]): string[] {
  if (match.courtCost <= 0) return [];

  const split = splitCourt({
    cost: match.courtCost,
    squad: squad.map((p) => p.id),
    payments: match.payments,
  });
  if (split.share === 0) return [];

  const lines = [
    `💸 Cancha ${formatMoney(match.courtCost)} — ${formatMoney(split.share)} cada uno`,
  ];

  const owing = squad.filter((p) => match.payments[p.id] === undefined);
  if (owing.length > 0 && owing.length < split.head) {
    lines.push(`  Faltan: ${owing.map(playerShortName).join(", ")}`);
  }

  return lines;
}

/** Filename-safe version of the match name. */
function slug(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned === "" ? "fulbito" : cleaned;
}
