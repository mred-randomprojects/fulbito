import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Pitch, type PitchToken } from "./Pitch";
import { loadShare, type SharePayload, type ShareTeam } from "@/cloudStorage";
import { isFirebaseConfigured } from "@/firebase";
import { KITS, type KitId } from "@/types";

/**
 * The read-only lineup, for everyone who was not the one picking the teams.
 *
 * Deliberately standalone: no sign-in, no roster, no controls. It renders from
 * a frozen snapshot, so re-shuffling the teams afterwards cannot change a link
 * somebody has already sent to twelve people.
 */
export function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );

  useEffect(() => {
    if (id == null || !isFirebaseConfigured) {
      setState("missing");
      return;
    }
    let cancelled = false;
    loadShare(id)
      .then((result) => {
        if (cancelled) return;
        if (result == null) {
          setState("missing");
          return;
        }
        setPayload(result);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[share] load failed:", err);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state !== "ready" || payload == null) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="mb-3 text-4xl" aria-hidden>
          ⚽
        </span>
        <h1 className="text-xl font-medium">
          {state === "error" ? "Could not load these teams" : "These teams are gone"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state === "error"
            ? "Something went wrong fetching the lineup. Try again in a moment."
            : "The link may have expired, or it was never published from this app."}
        </p>
      </div>
    );
  }

  const tokens = [
    ...teamTokens(payload.teamA, "A"),
    ...teamTokens(payload.teamB, "B"),
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{payload.matchName}</h1>
        {payload.date !== "" && (
          <p className="text-sm text-muted-foreground">{formatDate(payload.date)}</p>
        )}
      </header>

      <Pitch
        tokens={tokens}
        labelB={<TeamLabel team={payload.teamB} showRatings={payload.showRatings} />}
        labelA={<TeamLabel team={payload.teamA} showRatings={payload.showRatings} />}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <TeamList team={payload.teamA} showRatings={payload.showRatings} />
        <TeamList team={payload.teamB} showRatings={payload.showRatings} />
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Teams picked with <span className="font-medium">Fulbito</span>
      </p>
    </div>
  );
}

function kitOf(kit: string): (typeof KITS)[KitId] {
  return KITS[kit as KitId] ?? KITS.light;
}

function teamTokens(team: ShareTeam, half: "A" | "B"): PitchToken[] {
  const kit = kitOf(team.kit);
  return team.slots
    .filter((slot) => slot.name !== "")
    .map((slot, index) => ({
      key: `${half}-${index}`,
      x: slot.x,
      y: slot.y,
      half,
      name: shortName(slot.name),
      avatar: slot.avatar,
      seed: `${half}-${slot.name}`,
      role: slot.role,
      rating: slot.rating,
      ring: kit.ring,
      chip: kit.fill,
      chipText: kit.text,
    }));
}

function TeamLabel({ team, showRatings }: { team: ShareTeam; showRatings: boolean }) {
  const kit = kitOf(team.kit);
  const count = team.slots.filter((slot) => slot.name !== "").length;
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-lg shadow-black/40"
      style={{ background: kit.fill, color: kit.text }}
    >
      <span>{team.name}</span>
      <span className="tabular opacity-70">{count}</span>
      {showRatings && team.total !== undefined && (
        <span className="tabular rounded-full bg-black/15 px-1.5 py-0.5">
          {team.total.toFixed(1)}
        </span>
      )}
    </div>
  );
}

function TeamList({ team, showRatings }: { team: ShareTeam; showRatings: boolean }) {
  const kit = kitOf(team.kit);
  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: `${kit.fill}44`, background: kit.soft }}
    >
      <h2 className="mb-2 flex items-baseline justify-between gap-2 font-semibold">
        <span>{team.name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {team.formationLabel}
        </span>
      </h2>
      <ul className="space-y-1 text-sm">
        {team.slots
          .filter((slot) => slot.name !== "")
          .map((slot, index) => (
            <li key={index} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                <span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {slot.role}
                </span>
                {slot.name}
              </span>
              {showRatings && slot.rating !== undefined && (
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {slot.rating.toFixed(1)}
                </span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
