import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, KeyRound, LoaderCircle, Monitor } from "lucide-react";
import type { ModelConfigurationState } from "../../shared/assistant.ts";
import type { OrbitDesktopBridge } from "../../shared/desktop.d.ts";
import { useWorkspaceRequest } from "../api.ts";
import Dialog from "./Dialog.tsx";
import { useWorkspaceMode } from "./WorkspaceModeRoot.tsx";
import SharedMemoryEditor from "./SharedMemoryEditor.tsx";
import OrganizerSettings from "./OrganizerSettings.tsx";
import type { Message } from "../../shared/types.ts";

interface Props {
  messages?: Message[];
  onClose(): void;
  onSaved(): Promise<void>;
}
type DesktopInfo = Awaited<ReturnType<OrbitDesktopBridge["getInfo"]>>;
const models = [
  { id: "deepseek-flash", label: "DeepSeek Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

export default function SettingsDialog({ onClose, onSaved, messages = [] }: Props) {
  const request = useWorkspaceRequest();
  const { mode } = useWorkspaceMode();
  const [tab, setTab] = useState<"general" | "organizer" | "memory">("general");
  const [config, setConfig] = useState<ModelConfigurationState | null>(null);
  const [model, setModel] = useState("deepseek-flash");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  const alive = useRef(true);
  const inputId = useId();
  const modelId = useId();
  const keyHelpId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const state = await request<ModelConfigurationState>("/model-config");
      if (alive.current) {
        setConfig(state);
        setModel(models.some(item => item.id === state.model) ? state.model : "deepseek-flash");
      }
    } catch {
      if (alive.current) setError("暂时无法读取模型设置，请重试。");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    if (window.orbitDesktop) {
      void window.orbitDesktop.getInfo().then(value => {
        if (alive.current) setInfo(value);
      }).catch(() => {
        if (alive.current) setInfoError(true);
      });
    }
    return () => { alive.current = false; };
  }, [load]);

  const save = async (clear = false) => {
    if (pending || loading || !config || mode.demo) return;
    setPending(clear ? "clear" : "save");
    setMessage("");
    setError("");
    const key = apiKey.trim();
    try {
      const state = await request<ModelConfigurationState>("/model-config", "PUT", {
        model,
        ...(clear ? { clear: true } : key ? { apiKey: key } : {}),
      });
      if (alive.current) {
        setConfig(state);
        setApiKey("");
        setConfirmClear(false);
        setMessage(clear ? "API Key 已清除。" : "设置已保存，将用于后续请求。");
      }
      try { await onSaved(); }
      catch { if (alive.current) setError("设置已保存，但主页暂时未刷新。关闭设置后可重试。"); }
    } catch (cause) {
      // The server sanitizes errors; also remove the just-entered value before displaying them.
      let detail = cause instanceof Error ? cause.message : "保存失败，请重试。";
      if (key) detail = detail.split(key).join("[已隐藏]");
      if (alive.current) setError(detail);
    } finally { if (alive.current) setPending(null); }
  };

  return <Dialog title="设置" onClose={onClose}>
    <nav className="dt-settings-tabs" aria-label="设置分类">{([{ id: "general", label: "通用" }, { id: "organizer", label: "自动整理" }, { id: "memory", label: "通用记忆" }] as const).map(item => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {tab === "organizer" && <OrganizerSettings onChanged={onSaved}/>}
    {tab === "memory" && <SharedMemoryEditor messages={messages} onChanged={onSaved}/>}
    {tab === "general" && <form className="dt-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <section className="dt-settings-section" aria-labelledby={`${inputId}-heading`}>
        <div className="dt-settings-section-heading"><KeyRound size={17}/><h3 id={`${inputId}-heading`}>模型连接</h3></div>
        <p className="dt-settings-description">{mode.demo ? "演示使用现有模型连接；退出演示后可修改。" : "连接你的 DeepSeek 账户，开始讨论和推进工作。"}</p>
        {loading ? <p className="dt-settings-status"><LoaderCircle size={14} className="dt-spin"/>正在读取设置…</p>
          : config ? <>
            <div className="dt-settings-field">
              <label htmlFor={inputId}>API Key {config.configured && <span className="dt-settings-configured"><Check size={12}/>已配置</span>}</label>
              <input id={inputId} type="password" data-autofocus value={apiKey} onChange={event => { setApiKey(event.target.value); setMessage(""); }} placeholder={config.configured ? "留空保留现有密钥" : "输入 DeepSeek API Key"} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={Boolean(pending) || mode.demo} aria-describedby={keyHelpId}/>
              <p id={keyHelpId} className="dt-settings-help">密钥保存在本机，不会出现在对话中。此处不会显示已保存的密钥。</p>
            </div>
            <div className="dt-settings-field">
              <label htmlFor={modelId}>默认模型</label>
              <select id={modelId} value={model} onChange={event => { setModel(event.target.value); setMessage(""); }} disabled={Boolean(pending) || mode.demo}>
                {models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            <div className="dt-settings-actions">
              {config.configured && <button type="button" className="dt-text-button dt-danger" disabled={Boolean(pending) || mode.demo} onClick={() => setConfirmClear(true)}>清除密钥</button>}
              <button type="submit" className="dt-primary" disabled={Boolean(pending) || mode.demo}>{pending === "save" ? <><LoaderCircle size={14} className="dt-spin"/>保存中…</> : "保存设置"}</button>
            </div>
            {confirmClear && <div className="dt-settings-confirm" role="group" aria-label="确认清除密钥">
              <p>清除本机保存的 API Key？之后需要重新配置才能使用模型，已有对话和文件会保留。</p>
              <div className="dt-settings-actions"><button type="button" className="dt-secondary" disabled={Boolean(pending) || mode.demo} onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="dt-danger-button" disabled={Boolean(pending) || mode.demo} onClick={() => void save(true)}>{pending === "clear" ? "清除中…" : "确认清除"}</button></div>
            </div>}
          </> : <button type="button" className="dt-secondary" onClick={() => void load()}>重新读取</button>}
      </section>



      <section className="dt-settings-section dt-settings-about" aria-labelledby={`${inputId}-about`}>
        <div className="dt-settings-section-heading"><Monitor size={17}/><h3 id={`${inputId}-about`}>关于 Orbit</h3></div>
        {info ? <dl className="dt-settings-details">
          <div><dt>版本</dt><dd>{info.version}</dd></div>
          <div><dt>唤起助手</dt><dd>{info.shortcut}</dd></div>
          <div><dt>全局快捷键</dt><dd>{info.shortcutRegistered ? "已启用" : "未能注册，可从菜单栏打开助手"}</dd></div>
        </dl> : <p className="dt-settings-description">{window.orbitDesktop ? infoError ? "暂时无法读取客户端信息。" : "正在读取客户端信息…" : "当前在浏览器中使用；桌面客户端支持全局快捷键唤起。"}</p>}
      </section>
      {message && <p className="dt-settings-success" role="status"><Check size={14}/>{message}</p>}
      {error && <p className="dt-settings-error" role="alert">{error}</p>}
    </form>}
  </Dialog>;
}
