import { playerShortName, type Player } from "../types";
import { drawAvatar, loadPhotos, roundRect, toPng } from "./canvas";
import { formatMatchDate } from "./dates";
import type { Fixture } from "./tournament";

/**
 * Draws the whole torneito as one shareable image.
 *
 * The same bet `lineupImage.ts` makes, for a bigger thing: what people do with
 * teams is paste them into the group chat, and a PNG does that with no account
 * and no link that can rot. What is different is that a torneito has no pitch
 * to draw — twenty people are not on it at once — so this is a board rather
 * than a picture of a game: who is in each team, and in what order they play.
 *
 * The height is computed rather than fixed. Four fives and eight threes are
 * both normal, and a fixed canvas would either crop one or leave the other
 * mostly empty.
 */

const WIDTH = 1080;
const PAD = 32;
const GAP = 16;

const CARD_HEADER = 50;
const CARD_ROW = 46;
const CARD_FOOT = 12;

const ROUND_LABEL = 38;
const MATCH_ROW = 60;
const QUEUE_ROW = 54;
const BYE_ROW = 36;
const SECTION_TITLE = 52;
const FOOTER = 66;

export interface TournamentImageTeam {
  name: string;
  fill: string;
  /** Text colour that reads on `fill`. */
  text: string;
  players: readonly Player[];
  /** Drawn only when the user opted into showing ratings. */
  total: number | null;
}

export interface TournamentImageOptions {
  /** yyyy-MM-dd, or "" to leave the date off. */
  date: string;
  /** "20 jugadores en 4 equipos de 5". */
  shape: string;
  /** How each match is played — "a 2 goles", "7 minutos". "" to leave it off. */
  rule: string;
  teams: readonly TournamentImageTeam[];
  fixture: Fixture;
}

export async function renderTournamentImage(
  options: TournamentImageOptions,
): Promise<Blob> {
  const { teams, fixture } = options;

  const cols = columnsFor(teams.length);
  const rows = Math.max(1, ...teams.map((team) => team.players.length));
  const cardHeight = CARD_HEADER + rows * CARD_ROW + CARD_FOOT;
  const cardRows = Math.ceil(teams.length / cols);
  const cardWidth = (WIDTH - PAD * 2 - GAP * (cols - 1)) / cols;

  const headerHeight = options.rule === "" ? 138 : 182;
  const gridHeight = cardRows * cardHeight + (cardRows - 1) * GAP;
  const fixtureHeight = measureFixture(fixture);

  const height = Math.round(
    headerHeight + gridHeight + 28 + fixtureHeight + FOOTER,
  );

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx == null) throw new Error("El navegador no dio un canvas.");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  drawBackground(ctx, height);
  drawHeader(ctx, options);

  // Every photo up front; drawImage cannot wait mid-render.
  const photos = await loadPhotos(teams.flatMap((team) => [...team.players]));

  teams.forEach((team, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    drawTeamCard(ctx, photos, team, {
      x: PAD + col * (cardWidth + GAP),
      y: headerHeight + row * (cardHeight + GAP),
      width: cardWidth,
      height: cardHeight,
    });
  });

  drawFixture(ctx, fixture, teams, headerHeight + gridHeight + 28);
  drawFooter(ctx, height);

  return await toPng(canvas);
}

/**
 * How wide the grid of teams goes.
 *
 * Two columns for the shapes this is actually for — four fives is the whole
 * reason the screen exists — because a five-name card at half the width still
 * fits a full name. Past that it narrows rather than making the image taller
 * than a phone will preview.
 */
function columnsFor(teams: number): number {
  if (teams <= 4) return 2;
  if (teams <= 6) return 3;
  return 4;
}

function measureFixture(fixture: Fixture): number {
  if (fixture.format === "winner-stays") {
    return (
      SECTION_TITLE +
      ROUND_LABEL +
      MATCH_ROW +
      (fixture.queue.length > 0 ? ROUND_LABEL + fixture.queue.length * QUEUE_ROW : 0) +
      12 +
      BYE_ROW
    );
  }
  return (
    SECTION_TITLE +
    fixture.rounds.reduce(
      (sum, round) =>
        sum +
        ROUND_LABEL +
        round.matches.length * MATCH_ROW +
        (round.bye == null ? 0 : BYE_ROW) +
        10,
      0,
    )
  );
}

function drawBackground(ctx: CanvasRenderingContext2D, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0a1a12");
  gradient.addColorStop(1, "#050d09");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, height);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  options: TournamentImageOptions,
): void {
  ctx.fillStyle = "#f2f7f4";
  ctx.font = "700 48px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText("🏆 Torneito", WIDTH / 2, 48, WIDTH - PAD * 2);

  const subtitle =
    options.date === ""
      ? options.shape
      : `${options.shape} · ${formatMatchDate(options.date)}`;
  ctx.fillStyle = "rgba(242,247,244,0.6)";
  ctx.font = "400 27px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(subtitle, WIDTH / 2, 98, WIDTH - PAD * 2);

  if (options.rule !== "") {
    const label = `Cada partido: ${options.rule}`;
    ctx.font = "600 25px ui-sans-serif, system-ui, -apple-system, sans-serif";
    const width = Math.min(ctx.measureText(label).width + 40, WIDTH - PAD * 2);
    roundRect(ctx, WIDTH / 2 - width / 2, 128, width, 42, 21);
    ctx.fillStyle = "rgba(242,247,244,0.12)";
    ctx.fill();
    ctx.fillStyle = "rgba(242,247,244,0.85)";
    ctx.fillText(label, WIDTH / 2, 150, width - 24);
  }
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawTeamCard(
  ctx: CanvasRenderingContext2D,
  photos: Map<string, HTMLImageElement>,
  team: TournamentImageTeam,
  r: Rect,
): void {
  roundRect(ctx, r.x, r.y, r.width, r.height, 16);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = `${team.fill}55`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Header bar, squared off at the bottom so it reads as a band rather than a
  // floating pill.
  ctx.save();
  roundRect(ctx, r.x, r.y, r.width, r.height, 16);
  ctx.clip();
  ctx.fillStyle = team.fill;
  ctx.fillRect(r.x, r.y, r.width, CARD_HEADER);
  ctx.restore();

  const badge = team.total == null ? "" : team.total.toFixed(1);
  ctx.fillStyle = team.text;
  ctx.textAlign = "left";
  ctx.font = "700 26px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(team.name, r.x + 16, r.y + CARD_HEADER / 2, r.width - 120);

  ctx.textAlign = "right";
  ctx.font = "600 22px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.globalAlpha = 0.75;
  ctx.fillText(
    badge === "" ? `${team.players.length}` : `${team.players.length} · ${badge}`,
    r.x + r.width - 16,
    r.y + CARD_HEADER / 2,
  );
  ctx.globalAlpha = 1;

  team.players.forEach((player, index) => {
    const cy = r.y + CARD_HEADER + CARD_ROW * index + CARD_ROW / 2;
    drawAvatar(ctx, r.x + 16 + 16, cy, 16, player, photos.get(player.id), team.fill, 2);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(242,247,244,0.92)";
    ctx.font = "500 24px ui-sans-serif, system-ui, -apple-system, sans-serif";
    ctx.fillText(playerShortName(player), r.x + 58, cy + 1, r.width - 74);
  });

  ctx.textAlign = "center";
}

function drawFixture(
  ctx: CanvasRenderingContext2D,
  fixture: Fixture,
  teams: readonly TournamentImageTeam[],
  top: number,
): void {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(242,247,244,0.95)";
  ctx.font = "700 32px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(
    fixture.format === "round-robin" ? "El fixture" : "Cómo se juega",
    PAD,
    top + SECTION_TITLE / 2,
  );
  ctx.textAlign = "center";

  let y = top + SECTION_TITLE;

  if (fixture.format === "winner-stays") {
    y = drawSectionLabel(ctx, "Arrancan", y);
    drawMatchRow(ctx, teams, fixture.opener, y);
    y += MATCH_ROW;

    if (fixture.queue.length > 0) {
      y = drawSectionLabel(ctx, "Y van entrando", y);
      fixture.queue.forEach((index, position) => {
        drawQueueRow(ctx, teams, index, position + 1, y);
        y += QUEUE_ROW;
      });
    }

    drawNote(ctx, "El que gana se queda. El que pierde va al final de la fila.", y + 12);
    return;
  }

  fixture.rounds.forEach((round, index) => {
    y = drawSectionLabel(ctx, `Fecha ${index + 1}`, y);
    for (const match of round.matches) {
      drawMatchRow(ctx, teams, match, y);
      y += MATCH_ROW;
    }
    if (round.bye != null) {
      drawNote(ctx, `${nameOf(teams, round.bye)} descansa`, y);
      y += BYE_ROW;
    }
    y += 10;
  });
}

function nameOf(teams: readonly TournamentImageTeam[], index: number): string {
  return teams[index]?.name ?? `Equipo ${index + 1}`;
}

function drawSectionLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  y: number,
): number {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(242,247,244,0.5)";
  ctx.font = "600 23px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(label.toUpperCase(), PAD, y + ROUND_LABEL / 2);
  ctx.textAlign = "center";
  return y + ROUND_LABEL;
}

function drawNote(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.fillStyle = "rgba(242,247,244,0.45)";
  ctx.font = "400 22px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(text, WIDTH / 2, y + BYE_ROW / 2, WIDTH - PAD * 2);
}

/**
 * One pairing: two colour chips either side of a "vs".
 *
 * The chips carry the team colours because that is the only thing tying the
 * fixture back to the cards above it — nobody reads "Equipo 3" and remembers
 * which five that was, but everybody remembers they were the green ones.
 */
function drawMatchRow(
  ctx: CanvasRenderingContext2D,
  teams: readonly TournamentImageTeam[],
  match: { home: number; away: number },
  y: number,
): void {
  const cy = y + MATCH_ROW / 2;

  ctx.fillStyle = "rgba(242,247,244,0.4)";
  ctx.font = "600 22px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText("vs", WIDTH / 2, cy + 1);

  drawTeamChip(ctx, teams, match.home, WIDTH / 2 - 34, "right", cy);
  drawTeamChip(ctx, teams, match.away, WIDTH / 2 + 34, "left", cy);
}

const CHIP_FONT = "700 25px ui-sans-serif, system-ui, -apple-system, sans-serif";

/** How wide this team's chip wants to be, capped so it cannot cross the middle. */
function chipWidth(
  ctx: CanvasRenderingContext2D,
  name: string,
  limit: number,
): number {
  ctx.font = CHIP_FONT;
  return Math.min(ctx.measureText(name).width + 36, limit);
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  width: number,
  team: TournamentImageTeam | undefined,
  fallback: string,
): void {
  ctx.font = CHIP_FONT;
  roundRect(ctx, x, cy - 22, width, 44, 22);
  ctx.fillStyle = team?.fill ?? "#4a5a52";
  ctx.fill();
  ctx.fillStyle = team?.text ?? "#f2f7f4";
  ctx.fillText(team?.name ?? fallback, x + width / 2, cy + 1, width - 20);
}

function drawTeamChip(
  ctx: CanvasRenderingContext2D,
  teams: readonly TournamentImageTeam[],
  index: number,
  edge: number,
  side: "left" | "right",
  cy: number,
): void {
  const team = teams[index];
  const fallback = `Equipo ${index + 1}`;
  const width = chipWidth(ctx, team?.name ?? fallback, WIDTH / 2 - 34 - PAD);
  drawChip(ctx, side === "right" ? edge - width : edge, cy, width, team, fallback);
}

/**
 * One team in the queue: its place in the line, then its chip.
 *
 * Drawn as a chip rather than as a line of text because it has to read as the
 * same kind of thing as the pairing above it — this is still "who is playing",
 * just not yet against whom.
 */
function drawQueueRow(
  ctx: CanvasRenderingContext2D,
  teams: readonly TournamentImageTeam[],
  index: number,
  place: number,
  y: number,
): void {
  const cy = y + QUEUE_ROW / 2;
  const team = teams[index];
  const fallback = `Equipo ${index + 1}`;
  const width = chipWidth(ctx, team?.name ?? fallback, WIDTH - PAD * 2 - 44);

  const left = WIDTH / 2 - (width + 44) / 2;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(242,247,244,0.45)";
  ctx.font = "600 23px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(`${place}.`, left + 30, cy + 1);
  ctx.textAlign = "center";

  drawChip(ctx, left + 44, cy, width, team, fallback);
}

function drawFooter(ctx: CanvasRenderingContext2D, height: number): void {
  ctx.fillStyle = "rgba(242,247,244,0.4)";
  ctx.font = "400 24px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("armado con Fulbito", WIDTH / 2, height - 34);
}
