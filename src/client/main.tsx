import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import WorkspaceModeRoot from "./desktop/WorkspaceModeRoot.tsx";
import { hydrateDrafts } from "./desktop/workspace-state.ts";
const classic = new URLSearchParams(window.location.search).has("classic");
const next = new URLSearchParams(window.location.search).has("next");
const Legacy = lazy(async () => {
  await Promise.all([import("./styles.css"), import("./navigation.css"), import("./surface.css")]);
  return classic ? import("./App.tsx") : import("./NextApp.tsx");
});
const mount = () => createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {classic || next ? <Suspense fallback={null}><Legacy/></Suspense> : <WorkspaceModeRoot/>}
  </React.StrictMode>,
);
if (classic || next) void hydrateDrafts().finally(mount);
else mount();
