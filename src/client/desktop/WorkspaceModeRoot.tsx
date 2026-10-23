import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { WorkspaceMode } from '../../shared/workspace-mode.ts';
import { request } from '../api.ts';
import { currentWorkspaceMode, setWorkspaceMode, setWorkspaceSwitching, workspaceModeEvent, workspaceModeStorageKey } from '../workspace-mode.ts';
import { hydrateDrafts, setWorkspaceStorageMode } from './workspace-state.ts';
import DesktopApp from './DesktopApp.tsx';
import OrbitAvatar from './OrbitAvatar.tsx';

const ModeContext = createContext<{ mode: WorkspaceMode; changeMode(demo: boolean): Promise<void> } | null>(null);
export function useWorkspaceMode() {
  const value = useContext(ModeContext);
  if (!value) throw new Error('工作空间尚未准备好');
  return value;
}

export default function WorkspaceModeRoot() {
  const [mode, setMode] = useState<WorkspaceMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true), sequence = useRef(0), changing = useRef(false), readyRevision = useRef<string | null>(null);
  const apply = useCallback(async (next: WorkspaceMode, stamp: number) => {
    const changed = readyRevision.current !== next.revision;
    if (changed) {
      setBusy(true);
      setWorkspaceSwitching(true);
      setWorkspaceStorageMode(next.demo);
      if (!next.demo) await hydrateDrafts();
    }
    if (!alive.current || stamp !== sequence.current) return;
    setWorkspaceMode(next);
    readyRevision.current = next.revision;
    setMode(previous => previous?.revision === next.revision ? previous : next);
    setBusy(false); setError('');
  }, []);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const stamp = ++sequence.current;
    try {
      const next = await request<WorkspaceMode>('/workspace-mode');
      if (alive.current && stamp === sequence.current) await apply(next, stamp);
    } catch (cause) {
      if (alive.current && stamp === sequence.current) setError((cause as Error).message);
    }
  }, [apply]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const changed = () => { if (!changing.current) { setWorkspaceSwitching(true); setBusy(true); void refresh(); } };
    const storage = (event: StorageEvent) => { if (event.key === workspaceModeStorageKey && event.newValue !== currentWorkspaceMode()?.revision) changed(); };
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener(workspaceModeEvent, changed);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { alive.current = false; sequence.current++; clearInterval(timer); window.removeEventListener(workspaceModeEvent, changed); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const changeMode = useCallback(async (demo: boolean) => {
    if (!mode || changing.current || mode.demo === demo) return;
    changing.current = true; const stamp = ++sequence.current; setBusy(true); setError(''); setWorkspaceSwitching(true);
    window.dispatchEvent(new Event('orbit-voice-stop'));
    window.dispatchEvent(new Event('orbit-delivery-interrupt'));
    try {
      const next = await request<WorkspaceMode>('/workspace-mode', 'POST', { demo, revision: mode.revision });
      if (!alive.current) return;
      await apply(next, stamp);
      try { localStorage.setItem(workspaceModeStorageKey, next.revision); } catch { /* SSE also informs other windows. */ }
    } catch (cause) {
      // The server may have switched even if the response was lost. Verify before
      // showing any workspace; never remount the previous data on an assumption.
      try { const next = await request<WorkspaceMode>('/workspace-mode'); if (alive.current) await apply(next, stamp); }
      catch { if (alive.current) setError((cause as Error).message); }
    } finally { changing.current = false; }
  }, [mode, apply]);
  if (!mode || busy) return <div className="dt-root dt-boot"><OrbitAvatar size={48}/>{error ? <><p>{error}</p><button className="dt-secondary" onClick={() => void refresh()}>重新连接</button></> : <LoaderCircle size={17} className="dt-spin"/>}</div>;
  return <ModeContext.Provider value={{ mode, changeMode }}><DesktopApp key={mode.revision}/></ModeContext.Provider>;
}
