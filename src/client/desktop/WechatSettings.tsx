import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, LoaderCircle, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspaceRequest } from "../api.ts";
import { useWorkspaceMode } from "./WorkspaceModeRoot.tsx";

import type { WechatState, WechatReadResult, WechatInterpretation } from "../../shared/wechat.ts";
import type { ContactView, WechatPersonalState } from "../../shared/wechat-personal.ts";
import "./wechat-settings.css";
const labels: Record<string, string> = { stopped: "已暂停", starting: "正在启动", listening: "后台更新中", blocked: "需要完全磁盘访问权限", error: "读取暂不可用" };
function time(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }

export default function WechatSettings({ captureOnly = false }: { captureOnly?: boolean }) {
  const request = useWorkspaceRequest();
  const [state, setState] = useState<WechatState | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [personal, setPersonal] = useState<WechatPersonalState | null>(null);
  const [pending, setPending] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null), [data, setData] = useState<WechatReadResult | null>(null), [interpretation, setInterpretation] = useState<WechatInterpretation | null>(null), [confirmClear, setConfirmClear] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const { mode } = useWorkspaceMode();
  const alive = useRef(true), selectedRef = useRef(selected), revision = useRef(0), busy = useRef(false);
  selectedRef.current = selected;
  const load = useCallback(async () => {
    if (!alive.current) return;
    const current = ++revision.current;
    try {
      const [value, contacts] = await Promise.all([request<WechatState>("/wechat"), request<WechatPersonalState>("/wechat/personal")]);
      if (alive.current && current === revision.current) { setState(value); setPersonal(contacts); }
    }
    catch (cause) { if (alive.current && current === revision.current) setError((cause as Error).message); }
    finally { if (alive.current && current === revision.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; revision.current++;
    void load();
    const timer = window.setInterval(() => { if (!busy.current) void load(); }, 4000);
    return () => { alive.current = false; revision.current++; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    setData(null); setInterpretation(null); setConfirmClear(false);
    if (!selected) return;
    let cancelled = false; setMessagesLoading(true);
    void request<WechatReadResult>(`/wechat/chats/${encodeURIComponent(selected)}/messages`).then(value => { if (!cancelled) setData(value); }).catch(cause => { if (!cancelled) setError(cause.message); }).finally(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);
  async function action(key: string, path: string, method: string, body?: unknown) {
    if (busy.current || !alive.current) return;
    busy.current = true; revision.current++; setPending(key); setError("");
    try { await request(path, method, body); await load(); return true; }
    catch (cause) { if (alive.current) { setError((cause as Error).message); await load(); } return false; }
    finally { busy.current = false; if (alive.current) setPending(null); }
  }
  async function watch(contacts: ContactView[], enabled: boolean) {
    const updated = await action("watching", "/wechat/contacts/watching", "PATCH", { enabled, contacts: contacts.map(contact => ({ id: contact.id, version: contact.context.version, enabled: contact.enabled })) });
    if (updated) window.dispatchEvent(new Event("orbit-wechat-topics-changed"));
  }
  async function interpret() {
    if (!selected || busy.current || !alive.current) return;
    const chatId = selected; busy.current = true; setPending("interpret"); setError("");
    try { const value = await request<WechatInterpretation>(`/wechat/chats/${encodeURIComponent(chatId)}/interpret`, "POST", {}); if (alive.current && selectedRef.current === chatId) setInterpretation(value); }
    catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { busy.current = false; if (alive.current) setPending(null); }
  }
  async function permissionHelp(action: "settings" | "application") {
    try {
      if (action === "settings") await window.orbitDesktop?.openFullDiskAccessSettings();
      else await window.orbitDesktop?.revealApplication();
    } catch { setError("暂时无法打开，请手动前往系统设置 → 隐私与安全性 → 完全磁盘访问。"); }
  }
  const chat = state?.chats.find(item => item.id === selected);
  const diagnostics = state?.collector.diagnostics;
  const database = diagnostics?.database;
  const native = diagnostics?.native?.counters;
  const contacts = personal?.contacts || [];
  const watched = contacts.filter(contact => contact.enabled && contact.context.watching).length;
  const allWatched = contacts.length > 0 && watched === contacts.length;
  const partlyWatched = !allWatched && contacts.some(contact => contact.enabled || contact.context.watching);
  return <section className="dt-wechat-settings" aria-label="微信消息解读 Beta">
    {!captureOnly && <div className="dt-beta-heading"><MessageSquare size={21}/><h1>微信消息</h1><span>Beta</span></div>}
    {!mode.demo && <p className="dt-settings-description">只读系统保留的近期微信通知，内容可能不完整。</p>}
    {loading ? <p className="dt-panel-loading"><LoaderCircle size={14} className="dt-spin"/>正在读取…</p> : state && <>
      {!mode.demo && <><div className="dt-wechat-capture"><div><strong>读取微信通知</strong><small>{!state.supported ? "仅支持 macOS 桌面客户端" : !state.enabled ? "未开启" : labels[state.collector.status] || state.collector.status}</small></div><button className="dt-switch" role="switch" aria-label="读取微信通知" aria-checked={state.enabled} disabled={!!pending || !state.supported} onClick={() => void action("capture", "/wechat/capture", "POST", { enabled: !state.enabled })}><span/></button></div>
      {state.enabled && state.supported && ["stopped", "error", "blocked"].includes(state.collector.status) && <div className="dt-wechat-permission-actions">{state.collector.permission === "required" && window.orbitDesktop?.openFullDiskAccessSettings && <button type="button" className="dt-secondary" onClick={() => void permissionHelp("settings")}>打开完全磁盘访问设置</button>}<button type="button" className="dt-secondary" disabled={!!pending} onClick={() => void action("capture", "/wechat/capture", "POST", { enabled: true })}>{state.collector.status === "stopped" ? "继续更新" : state.collector.permission === "required" ? "重新检测" : "重新尝试"}</button></div>}
      {state.enabled && state.collector.detail && <p className={`dt-wechat-detail ${["blocked", "error"].includes(state.collector.status) ? "dt-wechat-needs-attention" : ""}`}>{state.collector.detail}</p>}
      {state.enabled && diagnostics && <details className="dt-wechat-permission-help"><summary>查看读取状态</summary><p>本次启动：保存 {diagnostics.messagesInserted} 条，重复 {diagnostics.duplicates} 条，保存失败 {diagnostics.importFailures} 次。</p>{database && <p>最近扫描 {time(database.scannedAt)}：读取 {database.rowsRead} 行，解析 {database.parsedRecords} 条，输出 {database.emittedRecords} 条，无效 {database.invalidRecords} 条。{database.limited > 0 && "本次扫描达到读取上限。"}</p>}{state.collector.mechanism === "accessibility" && native && <p>最近扫描：{native.windows} 个窗口、{native.nodes} 个节点；可解析 {native.parsedCards} 个通知。{native.traversalLimited > 0 && "本次扫描达到遍历上限。"}</p>}{diagnostics.lastError && <p>最近异常：{diagnostics.lastError.category}</p>}</details>}
      {state.enabled && state.collector.permission === "required" && <details className="dt-wechat-permission-help"><summary>如何授权 Orbit？</summary><p>在系统设置 → 隐私与安全性 → 完全磁盘访问中开启 Orbit，再退出并重新打开应用。若仍未识别，请移除列表里的旧版本，再用「＋」添加当前 Orbit。</p>{window.orbitDesktop?.revealApplication && <button type="button" className="dt-text-button" onClick={() => void permissionHelp("application")}>在 Finder 中显示当前 Orbit</button>}</details>}
      </>}
      <section className="dt-wechat-analysis" aria-label="消息分析">
        <h2>消息分析</h2>
        <div className="dt-wechat-analysis-toggle"><div><strong>关注全部聊天</strong><small>{pending === "watching" ? "正在保存…" : !contacts.length ? "读取到聊天后可开启" : allWatched ? `已关注全部 ${contacts.length} 个聊天` : partlyWatched ? `部分开启 · ${watched} / ${contacts.length} 个聊天自动关注` : "未开启"}</small></div><button type="button" className="dt-switch" role="checkbox" aria-label="关注全部聊天" aria-describedby="wechat-analysis-disclosure" aria-checked={partlyWatched ? "mixed" : allWatched} disabled={!!pending || !contacts.length} onClick={() => void watch(contacts, !allWatched)}><span/></button></div>
        <p id="wechat-analysis-disclosure">开启后，当前 {contacts.length} 个聊天的通知将发送给已配置的模型。你填写的背景和关联项目记忆也会用于分析。</p>
        <p>仅对当前列表生效，新聊天默认不关注。{!state.enabled && watched > 0 && "开启通知读取后开始自动分析。"}</p>
        {contacts.length > 0 && <details className="dt-wechat-analysis-contacts"><summary>按聊天管理<ChevronRight size={12}/></summary><div>{contacts.map(contact => <div className="dt-wechat-analysis-contact" key={contact.id}><span><strong>{contact.title}</strong><small>{contact.enabled && contact.context.watching ? "关注中" : contact.enabled ? "仅允许手动分析" : "未关注"}</small></span><button type="button" className="dt-switch" role="switch" aria-label={`关注聊天：${contact.title}`} aria-checked={contact.enabled && contact.context.watching} disabled={!!pending} onClick={() => void watch([contact], !(contact.enabled && contact.context.watching))}><span/></button></div>)}</div></details>}
      </section>
      {captureOnly && state.messageCount > 0 && <div className="dt-wechat-clear">{confirmClear ? <><p>停止采集并删除本机通知、联系人背景和分析。已经主动带入主对话的引用会保留。</p><button className="dt-secondary" disabled={!!pending} onClick={() => setConfirmClear(false)}>取消</button><button className="dt-danger-button" disabled={!!pending} onClick={async () => { if (await action("clear", "/wechat", "DELETE")) setConfirmClear(false); }}>确认清空</button></> : <button className="dt-text-button dt-danger" onClick={() => setConfirmClear(true)}><Trash2 size={12}/>停止并清空微信数据</button>}</div>}
      {!captureOnly && (selected ? <div className="dt-wechat-chat-panel"><div className="dt-wechat-chat-heading"><button type="button" className="dt-icon" aria-label="返回聊天来源列表" onClick={() => setSelected(null)}><ArrowLeft size={15}/></button><strong>{chat?.title || data?.chat.title || "聊天通知"}</strong><button type="button" className="dt-secondary" disabled={!state.enabled || !chat?.enabled || !!pending} onClick={() => void interpret()}>{pending === "interpret" ? <><LoaderCircle size={13} className="dt-spin"/>正在解读…</> : "解读最近消息"}</button></div>
        {!chat?.enabled && <p className="dt-wechat-subtle">先在来源列表中允许这个聊天参与解读。</p>}
        {interpretation && <div className="dt-wechat-interpretation"><span><Check size={12}/>消息解读 · {time(interpretation.generatedAt)}</span><p>{interpretation.summary}</p><small>依据 {interpretation.sources.length} 条通知，不会自动创建项目或执行消息中的要求。</small><details className="dt-wechat-evidence"><summary>查看本次解读依据</summary>{interpretation.sources.map(source => <article key={source.id}><header><strong>{source.sender || chat?.title || "微信"}</strong><time>{time(source.observedAt || source.timestamp)}</time></header><p>{source.text}</p></article>)}</details></div>}
        {messagesLoading ? <p className="dt-panel-loading"><LoaderCircle size={14} className="dt-spin"/>正在读取通知…</p> : <div className="dt-wechat-messages">{data?.messages.map(message => <article key={message.id}><header><strong>{message.sender || chat?.title || "微信"}</strong><time>{time(message.observedAt || message.timestamp)}</time></header><p>{message.text}</p>{message.source !== "notification" && <small>{message.source === "sample" ? "示例" : "导入记录"}</small>}</article>)}{!data?.messages.length && <p className="dt-panel-empty">这个聊天还没有可显示的通知。</p>}</div>}
        <button type="button" className="dt-text-button dt-danger" disabled={!!pending} onClick={async () => { if (await action("delete-chat", `/wechat/chats/${encodeURIComponent(selected)}`, "DELETE")) setSelected(null); }}><Trash2 size={12}/>删除这个聊天的通知</button>
      </div> : <><div className="dt-wechat-list-heading"><strong>聊天来源</strong><small>{state.messageCount} 条通知</small><button type="button" className="dt-icon" title="刷新" aria-label="刷新微信来源" onClick={() => void load()}><RefreshCw size={13}/></button></div>
        {state.chats.length ? <div className="dt-wechat-chats">{state.chats.map(item => <div key={item.id}><button className="dt-wechat-chat-open" onClick={() => { setSelected(item.id); setError(""); }}><MessageSquare size={15}/><span><strong>{item.title}</strong><small>{item.count} 条通知{item.source === "sample" ? " · 示例" : item.source === "import" ? " · 导入" : ""}</small></span><ChevronRight size={13}/></button><button type="button" className="dt-switch" role="switch" aria-label={`允许解读：${item.title}`} aria-checked={item.enabled} disabled={!!pending} onClick={() => void action(item.id, `/wechat/chats/${encodeURIComponent(item.id)}`, "PATCH", { enabled: !item.enabled })}><span/></button></div>)}</div> : <div className="dt-panel-empty"><p>还没有可显示的微信通知</p><span>{state.enabled ? "系统没有保留通知或微信未显示消息预览时，可能读不到内容。聊天来源默认不参与解读。" : "开启后读取近期通知，再选择哪些聊天可以交给 Orbit 解读。"}</span></div>}
        {state.messageCount > 0 && <div className="dt-wechat-clear">{confirmClear ? <><p>将停止采集并清空本机已保存的微信通知。已有对话中引用过的内容不会随之删除。</p><button type="button" className="dt-secondary" disabled={!!pending} onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="dt-danger-button" disabled={!!pending} onClick={async () => { if (await action("clear", "/wechat", "DELETE")) setConfirmClear(false); }}>确认清空</button></> : <button type="button" className="dt-text-button dt-danger" onClick={() => setConfirmClear(true)}><Trash2 size={12}/>停止并清空通知</button>}</div>}
      </>)}
    </>}
    {error && <p className="dt-settings-error" role="alert">{error}</p>}
  </section>;
}
