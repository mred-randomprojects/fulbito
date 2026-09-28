import { useCallback, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "./useAppData";
import { useCloudSync } from "./useCloudSync";
import { useTracking } from "./useTracking";
import { NavBar } from "./components/NavBar";
import { PlayersPage } from "./components/PlayersPage";
import { MatchesPage } from "./components/MatchesPage";
import { MatchBuilder } from "./components/MatchBuilder";
import { SplitPage } from "./components/SplitPage";
import { TeamsPage } from "./components/TeamsPage";
import { TournamentPage, TournamentsPage } from "./components/TournamentsPage";
import { SettingsPage } from "./components/SettingsPage";
import { PollsPage } from "./components/PollsPage";
import { SaveIndicator } from "./components/SaveIndicator";
import { ViewAsBanner } from "./components/ViewAsBanner";
import { ViewAsProvider, useViewAs } from "./viewAs";
import { useViewAsData } from "./useViewAsData";
import type { CloudState } from "./lib/cloudStatus";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  RATING_SCALE,
  newMatchId,
  type Match,
  type MatchId,
} from "./types";
import { defaultMatchName, todayIso } from "./lib/dates";
import { track } from "./lib/track";
import { findLiga } from "./lib/liga";
import { interceptSave } from "cmd-s";

export default function App() {
  return (
    <ViewAsProvider>
      <AppBody />
    </ViewAsProvider>
  );
}

/** Never shown on the save pill while viewing as somebody: none of it is ours. */
const CLOUD_OFF: CloudState = { kind: "off" };

function AppBody() {
  // Your own data and its sync stay mounted whoever is on screen: "Ver como"
  // hands the routes a different object, it does not swap this one out, so
  // nothing of somebody else's can reach your storage or your cloud copy.
  const own = useAppData();
  const ownCloud = useCloudSync(own);
  useTracking();
  const navigate = useNavigate();
  const viewAs = useViewAs();
  const other = useViewAsData(viewAs.target);
  const app = other.kind === "ready" ? other.app : own;
  const cloud = viewAs.target === null ? ownCloud : CLOUD_OFF;

  // ⌘S / Ctrl+S: keep the browser's "Save page" dialog away and answer with
  // the app's own receipt instead. `SaveIndicator` is that receipt, so no
  // toast of its own — `save` returns nothing.
  useEffect(() => interceptSave({ onSave: app.save }), [app.save]);

  const createMatch = useCallback(() => {
    const today = todayIso();
    const match: Match = {
      id: newMatchId(),
      ratingScale: RATING_SCALE,
      name: defaultMatchName(today),
      date: today,
      teamA: { ...DEFAULT_TEAM_A },
      teamB: { ...DEFAULT_TEAM_B },
      squad: [],
      pins: {},
      sizeA: 0,
      sizeB: 0,
      lineupA: [],
      lineupB: [],
      basis: "total",
      respectAvoids: true,
      respectTogether: true,
      handicap: 0,
      result: null,
      courtCost: 0,
      payments: {},
      notes: "",
      reviews: {},
      forecastNotes: "",
      videos: [],
      updatedAt: new Date().toISOString(),
    };
    app.saveMatch(match);
    track({ name: "match_created", matches: app.matches.length + 1 });
    navigate(`/matches/${match.id}`);
  }, [app, navigate]);

  const createTournamentMatches = useCallback(
    (matches: Match[], fields: number, teams: number) => {
      app.saveMatches(matches);
      track({
        name: "tournament_created",
        teams,
        matches: matches.length,
        fields,
      });
      const id = matches[0]?.tournament?.id;
      navigate(id === undefined ? "/matches" : `/torneos/${id}`);
    },
    [app, navigate],
  );

  return (
    <div className="min-h-dvh">
      <NavBar />
      <ViewAsBanner data={other} />

      {/* The pill at the bottom says a save failed; this says what to do about
          it, and stays up for as long as it is true. */}
      {own.saveStatus.kind === "error" && (
        <p className="mx-auto max-w-6xl px-4 pt-3">
          <span className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {own.saveStatus.message}
          </span>
        </p>
      )}

      {/* Sync failing is not the same emergency as saving failing — the work
          is safe on this device either way — but it is the kind of thing you
          want to know about before you walk to the cancha expecting your phone
          to have tonight's teams on it. */}
      {ownCloud.kind === "error" && (
        <p className="mx-auto max-w-6xl px-4 pt-3">
          <span className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {ownCloud.message}
          </span>
        </p>
      )}

      <main>
        {/* Somebody else's app, still on its way or refused: nothing of yours
            is drawn under their name in the meantime. */}
        {viewAs.target !== null && other.kind !== "ready" ? null : (
        <Routes>
          <Route path="/" element={<Navigate to="/matches" replace />} />
          <Route
            path="/matches"
            element={
              <MatchesPage
                matches={app.matches}
                players={app.players}
                onOpen={(match) => navigate(`/matches/${match.id}`)}
                onOpenTournament={(id) => navigate(`/torneos/${id}`)}
                onCreate={createMatch}
              />
            }
          />
          <Route path="/matches/:id" element={<MatchRoute app={app} />} />
          <Route
            path="/torneos"
            element={
              <TournamentsPage
                matches={app.matches}
                teams={app.teams}
                players={app.players}
                onCreateMatches={createTournamentMatches}
                onOpen={(id) => navigate(`/torneos/${id}`)}
              />
            }
          />
          <Route path="/torneos/:id" element={<TournamentRoute app={app} />} />
          <Route
            path="/split"
            element={
              <SplitPage
                players={app.players}
                matches={app.matches}
                savedTeams={app.teams}
                onSavePlayer={app.savePlayer}
                onDeletePlayer={app.deletePlayer}
                onSaveTeam={app.saveTeam}
              />
            }
          />
          <Route
            path="/teams"
            element={
              <TeamsPage
                teams={app.teams}
                players={app.players}
                matches={app.matches}
                onSave={app.saveTeam}
                onDelete={app.deleteTeam}
                onSavePlayer={app.savePlayer}
                onDeletePlayer={app.deletePlayer}
              />
            }
          />
          <Route
            path="/players"
            element={
              <PlayersPage
                players={app.players}
                matches={app.matches}
                onSave={app.savePlayer}
                onDelete={app.deletePlayer}
              />
            }
          />
          <Route
            path="/encuestas"
            element={
              <PollsPage
                players={app.players}
                matches={app.matches}
                onSavePlayer={app.savePlayer}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                data={app.data}
                onImport={app.importData}
                cloud={ownCloud}
                avatarStorage={app.avatarStorage}
              />
            }
          />
          <Route path="*" element={<Navigate to="/matches" replace />} />
        </Routes>
        )}
      </main>

      <SaveIndicator status={app.saveStatus} cloud={cloud} />
    </div>
  );
}

function MatchRoute({ app }: { app: ReturnType<typeof useAppData> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const match = id == null ? undefined : app.getMatch(id as MatchId);

  if (match === undefined) return <Navigate to="/matches" replace />;
  // A torneo game belongs to its board: that is where you came from and where
  // the next score gets written.
  const home = match.tournament === undefined ? "/matches" : `/torneos/${match.tournament.id}`;

  return (
    <MatchBuilder
      match={match}
      players={app.players}
      matches={app.matches}
      teams={app.teams}
      onChange={app.saveMatch}
      onDelete={() => {
        app.deleteMatch(match.id);
        navigate(home);
      }}
      onSavePlayer={app.savePlayer}
      onDeletePlayer={app.deletePlayer}
      onBack={() => navigate(home)}
    />
  );
}

function TournamentRoute({ app }: { app: ReturnType<typeof useAppData> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const liga = id == null ? undefined : findLiga(app.matches, id);

  if (liga === undefined) return <Navigate to="/torneos" replace />;

  return (
    <TournamentPage
      liga={liga}
      teams={app.teams}
      players={app.players}
      onSaveMatch={app.saveMatch}
      onSaveMatches={app.saveMatches}
      onDelete={(ids) => {
        app.deleteMatches(ids);
        navigate("/torneos");
      }}
      onOpenMatch={(match) => navigate(`/matches/${match.id}`)}
      onBack={() => navigate("/torneos")}
    />
  );
}
