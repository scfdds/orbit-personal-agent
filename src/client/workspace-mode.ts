import type { WorkspaceMode } from '../shared/workspace-mode.ts';

let mode: WorkspaceMode | null = null;
let switching = false;
export const workspaceModeEvent = 'orbit-workspace-mode-changed';
export const workspaceModeStorageKey = 'orbit-workspace-mode-revision';

export function currentWorkspaceMode() { return mode; }
export function setWorkspaceMode(value: WorkspaceMode) { mode = value; switching = false; }
export function setWorkspaceSwitching(value: boolean) { switching = value; }
export function workspaceRequestHeaders(): Record<string, string> {
  if (switching) throw new Error('正在切换工作空间，请稍后再试。');
  return mode ? { 'x-orbit-workspace': mode.revision } : {};
}
export function announceWorkspaceMode() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(workspaceModeEvent));
}
