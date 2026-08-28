import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { PollPage } from "./components/PollPage";
import { CloudAuthProvider } from "./cloud/auth";

// Hash routing, because GitHub Pages serves static files and would 404 on a
// deep link like /matches/abc under browser routing.
//
// The encuesta sits *beside* `App` rather than inside it, and that is the
// point: `App` mounts `useAppData` and `useCloudSync` at its top, and the
// person answering a poll has no roster of ours to load and no permission to
// upload one. Mounting it here is what keeps this route from touching either.
const router = createHashRouter([
  { path: "/encuesta/:pollId", element: <PollPage /> },
  { path: "*", element: <App /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Sits above the router because the answer to "is anybody signed in?"
        has to be known before the first screen decides what to show, and
        because for the many visitors who never sign in it is the thing that
        keeps Firebase from being downloaded at all. */}
    <CloudAuthProvider>
      <RouterProvider router={router} />
    </CloudAuthProvider>
  </StrictMode>,
);
