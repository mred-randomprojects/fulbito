import { useState } from "react";
import { Clapperboard, ExternalLink, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import {
  addVideo,
  embedUrl,
  hasVideo,
  parseVideoUrl,
  removeVideo,
  setVideoLabel,
  thumbnailUrl,
  videoSource,
  videoTitle,
  type MatchVideo,
  type VideoEmbed,
} from "@/lib/video";

interface Props {
  videos: MatchVideo[];
  onChange: (videos: MatchVideo[]) => void;
}

/**
 * The recordings of the game, with the scoreboard and the note, above the
 * tabs — because a video filed under Ajustes is a video nobody watches twice,
 * and the one thing worth opening a match from three weeks ago for is seeing
 * the goal again.
 *
 * Empty, it is one dashed row with a box to paste into: quiet enough not to
 * compete with picking the teams, present enough that nobody has to find a
 * button. With videos on it, each is a tile — a still where there is one, a
 * play button where there is not — that opens the player *under itself* on
 * a tap, and nothing loads until then: a match screen that pulled YouTube's
 * player down on every open would be paying for a thing most opens do not
 * want. One player open at a time, for the same reason and for the phone
 * that would otherwise be scrolling three of them.
 *
 * The label is a bare input beside the tile with no save button, because
 * nothing else up here has one: the box is the label. Every decision — what
 * counts as an address, what gets a player, what the same link twice means
 * — is `lib/video.ts`; this file reads the event and calls the function.
 */
export function VideoPanel({ videos, onChange }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  const add = (raw: string): boolean => {
    const next = addVideo(videos, raw);
    if (next === videos) return false;
    const embed = parseVideoUrl(raw);
    if (embed !== null) track({ name: "video_added", kind: embed.kind });
    onChange(next);
    // Straight to the player: the one thing anybody wants after pasting a
    // link is to see it is the right one.
    setOpen(next.length - 1);
    return true;
  };

  const remove = (index: number) => {
    onChange(removeVideo(videos, index));
    setOpen((current) => {
      if (current === null || current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  if (videos.length === 0) {
    return (
      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3">
        <Clapperboard className="h-5 w-5 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">¿Lo filmaron?</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pegá el link del video y queda acá, con el partido. YouTube, Vimeo,
            Drive, o lo que te dio la cancha.
          </p>
        </div>
        <AddForm videos={videos} onAdd={add} className="w-full sm:w-auto" />
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      <ul className="space-y-3">
        {videos.map((video, index) => (
          <VideoTile
            key={video.url}
            video={video}
            open={open === index}
            onToggle={() => setOpen(open === index ? null : index)}
            onLabel={(label) => onChange(setVideoLabel(videos, index, label))}
            onRemove={() => remove(index)}
          />
        ))}
      </ul>
      <AddForm videos={videos} onAdd={add} className="mt-3" compact />
    </section>
  );
}

/**
 * The paste box and its button. The button always works; what it says when
 * the link will not go in is said *after* the tap, not while the link is
 * still being typed — "eso no parece un link" under the first three letters
 * of `youtu.be` is nagging, and a pasted link is complete the moment it lands.
 */
function AddForm({
  videos,
  onAdd,
  className,
  compact = false,
}: {
  videos: MatchVideo[];
  onAdd: (raw: string) => boolean;
  className?: string;
  /** Under a list: the box is one of many things on the card, not the point of it. */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const submit = () => {
    if (draft.trim() === "") return;
    if (onAdd(draft)) {
      setDraft("");
      setRefused(null);
      return;
    }
    setRefused(
      parseVideoUrl(draft) === null
        ? "Eso no parece un link."
        : hasVideo(videos, draft)
          ? "Ese video ya está."
          : "No se pudo agregar.",
    );
  };

  return (
    <form
      className={cn("min-w-0", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setRefused(null);
          }}
          placeholder={compact ? "Pegá otro link…" : "Pegá el link…"}
          aria-label="Link del video"
          // Not `type="url"`: the browser would refuse "youtu.be/x" for
          // having no scheme, which `lib/video.ts` accepts on purpose.
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn("h-9", compact ? "border-transparent bg-transparent px-2" : "sm:w-72")}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={draft.trim() === ""}>
          Agregar
        </Button>
      </div>
      {refused !== null && (
        <p className="mt-1 px-2 text-xs text-amber-400" role="status">
          {refused}
        </p>
      )}
    </form>
  );
}

/**
 * One recording: the tile, the label, the way out, and the player when open.
 *
 * A stored address that is not one — a hand-edited blob is the only way —
 * gets a dead tile and no way out: an `<a href="no es un link">` would be a
 * link into this app, and nobody meant that.
 */
function VideoTile({
  video,
  open,
  onToggle,
  onLabel,
  onRemove,
}: {
  video: MatchVideo;
  open: boolean;
  onToggle: () => void;
  onLabel: (label: string) => void;
  onRemove: () => void;
}) {
  const embed = parseVideoUrl(video.url);
  const title = embed === null ? "Link roto" : videoTitle(video, embed);
  const playable = embed !== null && embed.kind !== "link";
  // 16:9, and small: on a phone the label beside it has to survive two icon
  // buttons on the right.
  const tile =
    "relative flex h-[45px] w-20 shrink-0 items-center justify-center overflow-hidden rounded-md";

  return (
    <li>
      <div className="flex items-center gap-2 sm:gap-3">
        {embed !== null && playable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Cerrar el video" : "Ver el video"}
            className={cn(
              tile,
              "group bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            )}
          >
            <Still embed={embed} />
            {open ? (
              <X className="absolute inset-0 m-auto h-6 w-6 text-white drop-shadow" />
            ) : (
              <Play
                fill="currentColor"
                className="absolute inset-0 m-auto h-6 w-6 text-white drop-shadow transition-transform group-hover:scale-110"
              />
            )}
          </button>
        ) : embed !== null ? (
          // Nothing to play in place: the tile is the way out, same as the
          // icon on the right, because a play button that opens a tab is a
          // lie and a tile that does nothing is worse.
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir el video en otra pestaña"
            className={cn(tile, "bg-secondary text-muted-foreground")}
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        ) : (
          <span className={cn(tile, "bg-secondary/50 text-muted-foreground/50")} aria-hidden>
            <X className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <Input
            value={video.label}
            onChange={(e) => onLabel(e.target.value)}
            placeholder="Primer tiempo, cámara del arco…"
            aria-label="Nombre del video"
            className="h-9 border-transparent bg-transparent px-2"
          />
          <p className="truncate px-2 text-xs text-muted-foreground">
            {embed === null ? `Link roto: ${video.url}` : videoSource(embed)}
          </p>
        </div>
        {embed !== null && (
          <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0 text-muted-foreground">
            <a href={video.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir en otra pestaña">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Sacar el video"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {open && embed !== null && playable && <Player embed={embed} title={title} />}
    </li>
  );
}

/** The still on the tile, where the host gives one away for free. */
function Still({ embed }: { embed: VideoEmbed }) {
  const still = thumbnailUrl(embed);
  if (still === null) return null;
  return <img src={still} alt="" className="h-full w-full object-cover opacity-80" />;
}

/**
 * The player itself. A frame for the hosts that have one, the browser's own
 * `<video>` for a bare file. `playsInline` so an iPhone plays it where it is
 * instead of taking over the screen for a clip of a five-a-side.
 */
function Player({ embed, title }: { embed: VideoEmbed; title: string }) {
  const src = embedUrl(embed);
  return (
    <div className="mt-3 overflow-hidden rounded-lg bg-black">
      {src !== null ? (
        <iframe
          src={src}
          title={title}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : embed.kind === "file" ? (
        <video src={embed.url} controls playsInline preload="metadata" className="aspect-video w-full" />
      ) : null}
    </div>
  );
}
