import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Volume2 } from "lucide-react";
import type { VoiceConfigurationState } from "../../shared/voice.ts";
import { useWorkspaceRequest } from "../api.ts";
import { useWorkspaceMode } from "./WorkspaceModeRoot.tsx";

export default function VoiceSettings() {
  const request = useWorkspaceRequest();
  const { mode } = useWorkspaceMode();
  const [config, setConfig] = useState<VoiceConfigurationState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const alive = useRef(true);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    window.dispatchEvent(new Event("orbit-voice-stop"));
    void request<VoiceConfigurationState>("/voice/config").then(value => {
      if (alive.current) setConfig(value);
    }).catch(() => { if (alive.current) setError("暂时无法读取语音设置。"); });
    return () => { alive.current = false; window.dispatchEvent(new Event("orbit-voice-stop")); };
  }, []);

  const save = async (clear = false) => {
    if (pending || mode.demo) return;
    setPending(true); setError(""); setMessage("");
    window.dispatchEvent(new Event("orbit-voice-stop"));
    try {
      const next = await request<VoiceConfigurationState>("/voice/config", "PUT", clear ? { clear: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {});
      if (alive.current) { setConfig(next); setApiKey(""); setConfirmClear(false); setMessage(clear ? "语音密钥已清除。" : "语音设置已保存。"); }
      window.dispatchEvent(new Event("orbit-voice-config-changed"));
    } catch { if (alive.current) setError("语音设置未能保存，请检查密钥后重试。"); }
    finally { if (alive.current) setPending(false); }
  };

  return <section className="dt-settings-section" aria-labelledby={`${id}-title`}>
    <div className="dt-settings-section-heading"><Volume2 size={17}/><h3 id={`${id}-title`}>语音</h3></div>
    <p className="dt-settings-description">点击麦克风开启连续语音，停顿后自动发送；也可以随时打字。Orbit 会打开相关内容，再用几句话讲解重点。开口即可打断，也可以随时静音。</p>
    {!config && !error && <p className="dt-settings-status"><LoaderCircle size={14} className="dt-spin"/>正在读取设置…</p>}
    <div className="dt-settings-field">
      <label htmlFor={id}>豆包语音 API Key {config?.configured && <span className="dt-settings-configured"><Check size={12}/>已配置</span>}</label>
      <input id={id} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={pending || mode.demo} value={apiKey} onChange={event => { setApiKey(event.target.value); setMessage(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void save(); } }} placeholder={config?.configured ? "留空保留现有密钥" : "输入豆包实时语音 API Key"}/>
      <p className="dt-settings-help">密钥仅保存在本机。开启麦克风后的音频和需要播报的文本会发送给豆包；麦克风由你手动开启，窗口收起后停止采集。</p>
    </div>
    <div className="dt-settings-actions">
      {config?.configured && <button type="button" className="dt-text-button dt-danger" disabled={pending || mode.demo} onClick={() => setConfirmClear(true)}>清除语音密钥</button>}
      <button type="button" className="dt-secondary" disabled={!config?.configured || pending} onClick={() => window.dispatchEvent(new CustomEvent("orbit-voice-preview", { detail: { text: "你好，我是 Orbit。语音已经准备好了。" } }))}>试听</button>
      <button type="button" className="dt-secondary" onClick={() => window.dispatchEvent(new Event("orbit-voice-stop"))}>停止</button>
      <button type="button" className="dt-primary" disabled={pending || mode.demo} onClick={() => void save()}>{pending ? "保存中…" : "保存语音设置"}</button>
    </div>
    {confirmClear && <div className="dt-settings-confirm">
      <p>清除本机保存的豆包语音密钥？之后仍可使用文字和系统朗读。</p>
      <div className="dt-settings-actions"><button type="button" className="dt-secondary" disabled={pending || mode.demo} onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="dt-danger-button" disabled={pending || mode.demo} onClick={() => void save(true)}>确认清除</button></div>
    </div>}
    {message && <p className="dt-settings-success" role="status"><Check size={14}/>{message}</p>}
    {error && <p className="dt-settings-error" role="alert">{error}</p>}
  </section>;
}
