import { useState } from "react";
import { Check, Copy, Link2, Loader2, MessageSquare } from "lucide-react";
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
import { publishShare, type SharePayload, type ShareTeam } from "@/cloudStorage";
import { useAuth } from "@/auth";
import { KIT_EMOJI, playerDisplayName, type Match, type TeamConfig } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: Match;
  evalA: TeamEvaluation;
  evalB: TeamEvaluation;
  formationA: Formation;
  formationB: Formation;
  /** False when there is no signed-in Firebase account behind this session. */
  canShare: boolean;
}

/**
 * Two ways out of the app.
 *
 * The text list is the one that gets used — it pastes straight into the group
 * chat where the game was organised, works with no account, and survives being
 * forwarded. The link is for when people want the picture.
 *
 * Ratings are excluded from both by default. The whole point of rating your
 * friends privately is that they never find out what you put.
 */
export function ShareDialog({
  open,
  onOpenChange,
  match,
  evalA,
  evalB,
  formationA,
  formationB,
  canShare,
}: Props) {
  const [includeRatings, setIncludeRatings] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"text" | "link" | null>(null);
  const { user } = useAuth();

  const text = buildText(match, evalA, evalB, formationA, formationB, includeRatings);

  const copy = async (value: string, kind: "text" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Your browser blocked the clipboard. Select the text and copy it by hand.");
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const payload: SharePayload = {
        matchName: match.name,
        date: match.date,
        teamA: buildShareTeam(match.teamA, evalA, formationA, includeRatings),
        teamB: buildShareTeam(match.teamB, evalB, formationB, includeRatings),
        showRatings: includeRatings,
        createdAt: new Date().toISOString(),
        // Recorded so the security rules can let the author — and only the
        // author — take a published lineup down again.
        ownerUid: user?.uid ?? "",
      };
      const id = await publishShare(payload);
      const url = `${window.location.origin}${window.location.pathname}#/share/${id}`;
      setShareUrl(url);
    } catch (e) {
      console.error("[share] publish failed:", e);
      setError("Could not create the link. Check your connection and try again.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share the teams</DialogTitle>
          <DialogDescription>
            Ratings stay private unless you say otherwise.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3">
          <input
            type="checkbox"
            checked={includeRatings}
            onChange={(e) => {
              setIncludeRatings(e.target.checked);
              setShareUrl(null);
            }}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-sm">
            <span className="font-medium">Include ratings</span>
            <span className="block text-xs text-muted-foreground">
              Shows each player's number and the team totals. Off by default —
              nobody enjoys finding out they are a 4.
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            As a message
          </Label>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-relaxed">
            {text}
          </pre>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void copy(text, "text")}
          >
            {copied === "text" ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copied === "text" ? "Copied" : "Copy for WhatsApp"}
          </Button>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label className="flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            As a link
          </Label>
          {!canShare ? (
            <p className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
              Sign in to publish a link. Everything works without an account, but
              a shareable page has to live somewhere other than this device.
            </p>
          ) : shareUrl != null ? (
            <div className="space-y-2">
              <p className="break-all rounded-lg border border-border bg-background p-3 text-xs">
                {shareUrl}
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void copy(shareUrl, "link")}
              >
                {copied === "link" ? (
                  <Check className="mr-1.5 h-4 w-4" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" />
                )}
                {copied === "link" ? "Copied" : "Copy link"}
              </Button>
              <p className="text-[11px] leading-snug text-muted-foreground">
                A snapshot — the page will not change if you re-shuffle the teams
                afterwards. Anyone with the link can open it.
              </p>
            </div>
          ) : (
            <Button className="w-full" onClick={() => void publish()} disabled={publishing}>
              {publishing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-1.5 h-4 w-4" />
              )}
              Create a shareable page
            </Button>
          )}
        </div>

        {error != null && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function buildShareTeam(
  config: TeamConfig,
  evaluation: TeamEvaluation,
  formation: Formation,
  includeRatings: boolean,
): ShareTeam {
  const team: ShareTeam = {
    name: config.name,
    kit: config.kit,
    formationLabel: formation.label,
    slots: formation.slots.map((slot, index) => {
      const player = evaluation.lineup[index];
      const entry = {
        role: slot.role,
        x: slot.x,
        y: slot.y,
        name: player == null ? "" : playerDisplayName(player),
        avatar: player?.avatar ?? "",
      };
      return includeRatings && player != null
        ? { ...entry, rating: Number(evaluation.slotRatings[index].toFixed(2)) }
        : entry;
    }),
  };
  if (includeRatings) {
    team.total = Number(evaluation.total.toFixed(2));
    team.average = Number(evaluation.average.toFixed(2));
  }
  return team;
}

/** Plain text, formatted for a group chat rather than for a spreadsheet. */
function buildText(
  match: Match,
  evalA: TeamEvaluation,
  evalB: TeamEvaluation,
  formationA: Formation,
  formationB: Formation,
  includeRatings: boolean,
): string {
  const lines: string[] = [];
  lines.push(`⚽ ${match.name}${match.date !== "" ? ` — ${formatDate(match.date)}` : ""}`);
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

  return lines.join("\n").trimEnd();
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
