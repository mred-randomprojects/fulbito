import { useCallback } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "./useAppData";
import { useCloudSync } from "./useCloudSync";
import { NavBar } from "./components/NavBar";
import { PlayersPage } from "./components/PlayersPage";
import { MatchesPage } from "./components/MatchesPage";
import { MatchBuilder } from "./components/MatchBuilder";
import { SplitPage } from "./components/SplitPage";
import { TeamsPage } from "./components/TeamsPage";
import { SettingsPage } from "./components/SettingsPage";
import { PollsPage } from "./components/PollsPage";
import { SaveIndicator } from "./components/SaveIndicator";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  newMatchId,
  type Match,
  type MatchId,
} from "./types";
import { defaultMatchName, todayIso } from "./lib/dates";

export default function App() {
  const app = useAppData();
  const cloud = useCloudSync(app);
  const navigate = useNavigate();

  const createMatch = useCallback(() => {
    const today = todayIso();
    const match: Match = {
      id: newMatchId(),
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
      handicap: 0,
      result: null,
      courtCost: 0,
      payments: {},
      updatedAt: new Date().toISOString(),
    };
    app.saveMatch(match);
    navigate(`/matches/${match.id}`);
  }, [app, navigate]);

  return (
    <div className="min-h-dvh">
      <NavBar />

      {/* The pill at the bottom says a save failed; this says what to do about
          it, and stays up for as long as it is true. */}
      {app.saveStatus.kind === "error" && (
        <p className="mx-auto max-w-6xl px-4 pt-3">
          <span className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {app.saveStatus.message}
          </span>
        </p>
      )}

      {/* Sync failing is not the same emergency as saving failing — the work
          is safe on this device either way — but it is the kind of thing you
          want to know about before you walk to the cancha expecting your phone
          to have tonight's teams on it. */}
      {cloud.kind === "error" && (
        <p className="mx-auto max-w-6xl px-4 pt-3">
          <span className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {cloud.message}
          </span>
        </p>
      )}

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/matches" replace />} />
          <Route
            path="/matches"
            element={
              <MatchesPage
                matches={app.matches}
                players={app.players}
                onOpen={(match) => navigate(`/matches/${match.id}`)}
                onCreate={createMatch}
              />
            }
          />
          <Route path="/matches/:id" element={<MatchRoute app={app} />} />
          <Route
            path="/split"
            element={
              <SplitPage
                players={app.players}
                matches={app.matches}
                onSavePlayer={app.savePlayer}
                onDeletePlayer={app.deletePlayer}
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
            element={<PollsPage players={app.players} onSavePlayer={app.savePlayer} />}
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                data={app.data}
                onImport={app.importData}
                cloud={cloud}
              />
            }
          />
          <Route path="*" element={<Navigate to="/matches" replace />} />
        </Routes>
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

  return (
    <MatchBuilder
      match={match}
      players={app.players}
      matches={app.matches}
      teams={app.teams}
      onChange={app.saveMatch}
      onDelete={() => {
        app.deleteMatch(match.id);
        navigate("/matches");
      }}
      onSavePlayer={app.savePlayer}
      onDeletePlayer={app.deletePlayer}
      onBack={() => navigate("/matches")}
    />
  );
}
