import type { AppManifest, Snapshot } from "../shared/types.ts";
import AppCenter from "./AppCenter.tsx";

interface Props {
  state: Snapshot;
  onOpenApp: (appId: string) => void;
  onAppInfo: (app: AppManifest) => void;
  onNotify: (message: string) => void;
}
export default function GlobalViews({ state, onOpenApp, onAppInfo, onNotify }: Props) {
  return <AppCenter apps={state.apps} onOpenApp={onOpenApp} onAppInfo={onAppInfo} onNotify={onNotify}/>;
}
