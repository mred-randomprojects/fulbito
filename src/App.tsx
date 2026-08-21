import { useCallback } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "./auth";
import { useAppData } from "./useAppData";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./components/LoginPage";
import { PlayersPage } from "./components/PlayersPage";
import { MatchesPage } from "./components/MatchesPage";
import { MatchBuilder } from "./components/MatchBuilder";
import { SharePage } from "./components/SharePage";
import { AccountPage } from "./components/AccountPage";
import {
  DEFAULT_TEAM_A,
  DEFAULT_TEAM_B,
  newMatchId,
  type Match,
  type MatchId,
} from "./types";
import { defaultMatchName, todayIso } from "./lib/dates";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public: a shared lineup must open for people with no account. */}
        <Route path="/share/:id" element={<SharePage />} />
        <Route path="*" element={<AuthGate />} />
      </Routes>
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, loading, localOnly } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user == null && !localOnly) return <LoginPage />;

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const app = useAppData();
  const { user, localOnly } = useAuth();
  const navigate = useNavigate();

  const createMatch = useCallback(() => {
    const match: Match = {
      id: newMatchId(),
      name: defaultMatchName(todayIso()),
      date: todayIso(),
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
      <NavBar syncState={app.syncState} />

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
            path="/account"
            element={<AccountPage data={app.data} onImport={app.replaceAll} />}
          />
          <Route path="*" element={<Navigate to="/matches" replace />} />
        </Routes>
      </main>

      <footer className="px-4 py-8 text-center text-xs text-muted-foreground">
        {user != null && !localOnly
          ? "Sincronizado con tu cuenta."
          : "Guardado en este aparato."}
      </footer>
    </div>
  );
}

function MatchRoute({ app }: { app: ReturnType<typeof useAppData> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, localOnly } = useAuth();
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
      canShare={user != null && !localOnly}
    />
  );
}


