import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { CloudAuthProvider } from "./cloud/auth";

// Hash routing, because GitHub Pages serves static files and would 404 on a
// deep link like /matches/abc under browser routing.
const router = createHashRouter([{ path: "*", element: <App /> }]);

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
