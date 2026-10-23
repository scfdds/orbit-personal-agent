import { ArrowUpRight, BookOpen, Box, Download, Plug, Wrench } from "lucide-react";
import { AppMark } from "./VisualIdentity.tsx";
import { Modal } from "./ui.tsx";
import { capabilityLabel, categoryLabel, type AppDetailData, type CapabilityItem } from "./app-catalog.ts";

export default function AppDetails({app, onClose, onAction, busy = false}: {
  app: AppDetailData; onClose: () => void; onAction: () => void; busy?: boolean;
}) {
  const full = app.capabilityType === "app";
  function components(title: string, items: CapabilityItem[], Icon: typeof BookOpen, empty: string) {
    return <section className="store-detail-section"><h3>{title}<span>{items.length}</span></h3>{items.length ? <div className="store-components">{items.map(item => <div className="store-component" key={item.name}><span className="store-component-icon"><Icon size={18}/></span><div><strong>{item.name}</strong><p>{item.description}</p></div></div>)}</div> : <p className="store-empty-component">{empty}</p>}</section>;
  }
  return <Modal title="应用详情" onClose={onClose} wide><div className="modal-body store-detail">
    <header className="store-detail-hero"><AppMark id={app.mark} size={64}/><div className="store-detail-heading"><h2>{app.name}<span>{capabilityLabel(app.capabilityType)}</span></h2><p>{app.description}</p><div className="store-detail-byline">{app.publisher} · v{app.version}{!app.connected && " · 示例信息"}</div></div><button className="button primary" disabled={busy} onClick={onAction}>{app.connected ? <><ArrowUpRight size={15}/>打开应用</> : <><Download size={15}/>安装</>}</button></header>
    {!app.connected && <p className="store-demo-notice">目录示例 · 尚未接入，暂不能安装。下列版本、能力组成和开发者信息用于原型展示，不代表官方服务或合作关系。</p>}
    <section className="store-detail-section"><h3>适合这样用</h3><div className="store-use-cases">{app.useCases.map(text => <div key={text}><span/><p>{text}</p></div>)}</div></section>
    <section className="store-panel-summary"><Box size={19}/><div><strong>{full ? "包含应用界面" : "在对话中使用"}</strong><p>{full ? "在右侧工作区打开，直接查看和编辑内容，与 Agent 协作。" : app.capabilityType === "skill" ? "提供任务方法与操作指南，供 Agent 按需使用，不包含独立 GUI 面板。" : "提供工具与数据连接，供 Agent 在对话中调用，不包含独立 GUI 面板。"}</p></div></section>
    {components("Skills",app.skills,BookOpen,"未包含独立 Skill。")}
    {components("MCP",app.mcpServers,Plug,"未接入 MCP 服务。")}
    {app.tools.length > 0 && components("应用工具",app.tools,Wrench,"")}
    <section className="store-detail-section"><h3>信息</h3><dl className="store-information"><dt>开发者</dt><dd>{app.publisher}{!app.connected && <small>目录示例</small>}</dd><dt>版本</dt><dd>{app.version}</dd><dt>能力类型</dt><dd>{capabilityLabel(app.capabilityType)}</dd><dt>适用领域</dt><dd>{categoryLabel(app.category)}</dd><dt>接入状态</dt><dd>{app.connected ? "已接入" : "未接入 · 暂不能安装"}</dd>{app.permissions.length > 0 && <><dt>访问范围</dt><dd>{app.permissions.join("；")}</dd></>}</dl></section>
  </div></Modal>;
}
