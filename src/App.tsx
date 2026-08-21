import { useCallback } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "./useAppData";
import { NavBar } from "./components/NavBar";
import { PlayersPage } from "./components/PlayersPage";
import { MatchesPage } from "./components/MatchesPage";
import { MatchBuilder } from "./components/MatchBuilder";
import { SettingsPage } from "./components/SettingsPage";
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
      handicap: 0,
      updatedAt: new Date().toISOString(),
    };
    app.saveMatch(match);
    navigate(`/matches/${match.id}`);
  }, [app, navigate]);

  return (
    <div className="min-h-dvh">
      <NavBar />

      {app.storageError != null && (
        <p className="mx-auto max-w-6xl px-4 pt-3">
          <span className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {app.storageError}
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
            path="/players"
            element={
              <PlayersPage
                players={app.players}
                onSave={app.savePlayer}
                onDelete={app.deletePlayer}
              />
            }
          />
          <Route
            path="/settings"
            element={<SettingsPage data={app.data} onImport={app.importData} />}
          />
          <Route path="*" element={<Navigate to="/matches" replace />} />
        </Routes>
      </main>
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
      onChange={app.saveMatch}
      onDelete={() => {
        app.deleteMatch(match.id);
        navigate("/matches");
      }}
      onSavePlayer={app.savePlayer}
      onBack={() => navigate("/matches")}
    />
  );
}
