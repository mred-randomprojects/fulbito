import { Banknote, Check, Gift } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "./PlayerAvatar";
import {
  collectedFraction,
  describeCollection,
  formatMoney,
  parseAmount,
  splitCourt,
  type PaymentBook,
  type PaymentState,
} from "@/lib/court";
import { playerDisplayName, type Player, type PlayerId } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  cost: number;
  /**
   * Who is splitting it: the squad, resolved to people.
   *
   * Resolved rather than raw ids on purpose. A player deleted from the roster
   * leaves their id in old squads — see `removePlayer` — and counting one of
   * those would leave a row nobody can tap and an amount that can never be
   * collected. The list you can see is the list being divided.
   */
  squad: Player[];
  payments: PaymentBook;
  onCostChange: (cost: number) => void;
  onCyclePayment: (id: PlayerId) => void;
}

/**
 * The other half of organising a picado: chasing everybody for the cancha.
 *
 * One number in, and the rest is a list you tap down as the money arrives.
 * Tapping cycles debe → pagó → bancado, so letting somebody off is the same
 * gesture as marking them paid rather than a separate switch hidden behind a
 * menu — and it is what re-divides the bill between the rest.
 *
 * Everything below the amount stays hidden until there is an amount, because
 * a list of people owing nothing is a list nobody needs to read.
 */
export function CourtPanel({
  cost,
  squad,
  payments,
  onCostChange,
  onCyclePayment,
}: Props) {
  const split = splitCourt({
    cost,
    squad: squad.map((p) => p.id),
    payments,
  });
  const priced = cost > 0;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Banknote className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">La cancha</h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="shrink-0">¿Cuánto salió?</span>
          <span className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            {/* Plain digits, like the goal boxes: re-grouping the number under
                the cursor on every keystroke moves the caret out from under
                the thumb. The grouped amount is right below instead. */}
            <Input
              value={cost === 0 ? "" : String(cost)}
              inputMode="numeric"
              placeholder="0"
              onChange={(e) => onCostChange(parseAmount(e.target.value))}
              aria-label="Cuánto salió la cancha"
              className="tabular h-10 w-32 pl-7 text-right font-semibold"
            />
          </span>
        </label>

        {priced && split.share > 0 && (
          <p className="text-sm">
            <span className="tabular font-semibold text-primary">
              {formatMoney(split.share)}
            </span>{" "}
            <span className="text-muted-foreground">
              por cabeza, entre {split.payers}
              {split.comped > 0 && ` (a ${split.comped} se la bancás)`}
            </span>
          </p>
        )}
      </div>

      {!priced ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Poné cuánto salió y te digo cuánto pone cada uno. Después vas
          tachando a los que ya pusieron.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {/* Decorative: the line under it says the same thing in words. */}
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
              aria-hidden="true"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  split.settled ? "bg-emerald-500" : "bg-primary",
                )}
                style={{ width: `${Math.round(collectedFraction(split) * 100)}%` }}
              />
            </div>
            <p
              className={cn(
                "text-xs leading-relaxed",
                split.settled ? "text-emerald-400" : "text-muted-foreground",
              )}
            >
              {describeCollection(split)}
            </p>
          </div>

          {squad.length > 0 && (
            <ul className="space-y-1">
              {squad.map((player) => (
                <li key={player.id}>
                  <PayerRow
                    player={player}
                    state={payments[player.id]}
                    share={split.share}
                    onClick={() => onCyclePayment(player.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Tocá a alguien para marcar que pagó. Tocalo de nuevo si le bancás la
            cancha: sale del reparto y el resto pone un poco más.
          </p>
        </>
      )}
    </section>
  );
}

function PayerRow({
  player,
  state,
  share,
  onClick,
}: {
  player: Player;
  state: PaymentState | undefined;
  share: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors",
        state === "paid"
          ? "border-emerald-500/40 bg-emerald-500/10"
          : state === "comped"
            ? "border-primary/40 bg-primary/10"
            : "border-border hover:bg-accent/40",
      )}
    >
      <PlayerAvatar player={player} size={28} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          state === "paid" && "text-muted-foreground line-through",
        )}
      >
        {playerDisplayName(player)}
      </span>
      {state === "paid" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          Pagó
        </span>
      ) : state === "comped" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
          <Gift className="h-3.5 w-3.5" />
          Bancado
        </span>
      ) : (
        <span className="tabular shrink-0 text-xs font-medium text-muted-foreground">
          Debe {formatMoney(share)}
        </span>
      )}
    </button>
  );
}
