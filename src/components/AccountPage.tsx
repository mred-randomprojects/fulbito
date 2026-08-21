import { useRef, useState } from "react";
import { Download, HardDrive, LogOut, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth";
import { getStorageUsage } from "@/storage";
import { normalizeAppData, type AppData } from "@/types";

interface Props {
  data: AppData;
  onImport: (data: AppData) => void;
}

export function AccountPage({ data, onImport }: Props) {
  const { user, cloudAvailable, localOnly, signIn, signOut } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const usage = getStorageUsage();
  const usedPercent = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fulbito-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (file === undefined) return;
    setMessage(null);
    try {
      const parsed = normalizeAppData(JSON.parse(await file.text()));
      onImport(parsed);
      setMessage(
        `Merged in ${parsed.players.length} player${parsed.players.length === 1 ? "" : "s"} and ${parsed.matches.length} match${parsed.matches.length === 1 ? "" : "es"}.`,
      );
    } catch {
      setMessage("That file could not be read as a Fulbito backup.");
    } finally {
      if (fileInput.current != null) fileInput.current.value = "";
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Sync</h2>
        {!cloudAvailable ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            This build has no Firebase project behind it, so everything is saved
            on this device only. Add the <code className="text-xs">VITE_FIREBASE_*</code>{" "}
            variables to turn on sync and shareable links.
          </p>
        ) : user != null && !localOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">
                {user.email ?? user.uid}
              </span>
            </p>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              <LogOut className="mr-1.5 h-4 w-4" />
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Working on this device only. Sign in to sync across devices and
              publish share links.
            </p>
            <Button size="sm" onClick={() => void signIn()}>
              Sign in
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <HardDrive className="h-4 w-4" />
          Storage on this device
        </h2>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {(usage.usedBytes / 1024).toFixed(0)} KB of roughly{" "}
          {(usage.quotaBytes / 1024 / 1024).toFixed(0)} MB used.{" "}
          {data.players.filter((p) => p.avatar !== "").length} photo
          {data.players.filter((p) => p.avatar !== "").length === 1 ? "" : "s"} stored
          — photos are shrunk on upload, but they are still the bulk of it.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Backup</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          Export everything — players, photos and matches — as a single JSON
          file. Importing merges rather than replaces, so nothing gets lost.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={exportData}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void importData(e.target.files?.[0])}
          />
        </div>
        {message != null && (
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">How the balancing works</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>
            Every player has one overall rating. That is the floor — a player
            with nothing else filled in is worth exactly that number.
          </li>
          <li>
            A position rating, where you set one, moves them decisively in that
            position. Attributes then nudge the result, in proportion to how many
            you actually filled in. Missing data never costs a player anything.
          </li>
          <li>
            Each team is scored at its <em>best</em> arrangement, so a specialist
            keeper only counts if the shape puts them in goal.
          </li>
          <li>
            The split is chosen by checking every legal combination and scoring
            it on total strength, each line, top-heaviness, and the gap between
            the two best players.
          </li>
        </ul>
      </section>
    </div>
  );
}
