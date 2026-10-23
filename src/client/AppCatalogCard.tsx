import { ArrowUpRight, Check, Download } from "lucide-react";
import { AppMark } from "./VisualIdentity.tsx";

export default function AppCatalogCard({
  name, description, mark, tags, connected, publisher, onAction, onDetails,
}: {
  name: string;
  description: string;
  mark: string;
  tags: string[];
  connected: boolean;
  publisher?: string;
  onAction: () => void;
  onDetails: () => void;
}) {
  return (
    <article className="app-directory-card">
      <button className="directory-app-heading" onClick={onDetails} aria-label={`查看${name}详情`}>
        <AppMark id={mark} size={48} />
        <span>
          <strong>{name}</strong>
          <span className={connected ? "installed-label" : "ecosystem-label"}>
            {connected ? <><Check size={12} />已接入 · {publisher || "Orbit"}</> : `未接入 · ${publisher || "目录示例"}`}
          </span>
        </span>
      </button>
      <p>{description}</p>
      <div className="capability-tags">
        {tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="directory-card-actions">
        <button className="button secondary small" onClick={onAction} aria-label={`${connected ? "打开" : "安装"}${name}`}>
          {connected ? <><ArrowUpRight size={14} />打开应用</> : <><Download size={14} />安装</>}
        </button>
        <button className="quiet-button" onClick={onDetails} aria-label={`${name}的详情`}>查看详情</button>
      </div>
    </article>
  );
}
