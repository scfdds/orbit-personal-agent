import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AppManifest } from "../shared/types.ts";
import AppCatalogCard from "./AppCatalogCard.tsx";
import AppDetails from "./AppDetails.tsx";
import { SurfaceHeader, SurfaceSearch } from "./SurfaceHeader.tsx";
import { capabilityTypes, capabilityLabel, catalogExamples, exampleDetails, matchesApp, type CatalogExample } from "./app-catalog.ts";
import "./app-center.css";

export default function AppCenter({ apps, onOpenApp, onAppInfo, onNotify }: {
  apps: AppManifest[]; onOpenApp: (id: string) => void;
  onAppInfo: (app: AppManifest) => void; onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [detail, setDetail] = useState<CatalogExample | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const installed = useMemo(() => apps.filter(app => app.id !== "memory"), [apps]);
  const visibleInstalled = installed.filter(app => (category === "all" || category === "app") && matchesApp(query, app));
  const visibleExamples = installedOnly ? [] : catalogExamples.filter(app => (category === "all" || app.capabilityType === category) && matchesApp(query, app));
  const unavailable = (app: CatalogExample) => onNotify(`${app.name}暂不能安装，当前为应用目录展示。`);
  return <div className="app-center-page catalog-page">
    <SurfaceHeader title="应用中心"><SurfaceSearch label="搜索应用" placeholder="搜索应用、能力或场景…" value={query} onChange={setQuery}/></SurfaceHeader>
      <div className="surface-filterbar catalog-toolbar">
        <nav className="surface-tabs" aria-label="能力类型">
          <button className={category === "all" ? "selected" : ""} aria-pressed={category === "all"} onClick={() => setCategory("all")}>所有应用</button>
          {capabilityTypes.map(item => <button key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </nav>
        <label className="catalog-installed-toggle"><input type="checkbox" checked={installedOnly} onChange={e => setInstalledOnly(e.target.checked)}/><span>已安装</span></label>
      </div>
    <div className="catalog-scroll"><div className="catalog-inner">
      <div className="app-directory catalog-grid">
        {visibleInstalled.map(app => <AppCatalogCard key={app.id} name={app.name} description={app.description} mark={app.id} tags={[capabilityLabel("app"), ...app.capabilities]} publisher={app.publisher || "Orbit Labs"} connected onAction={() => onOpenApp(app.id)} onDetails={() => onAppInfo(app)}/>)}
        {visibleExamples.map(app => <AppCatalogCard key={app.id} {...app} tags={[capabilityLabel(app.capabilityType || "app"), ...app.tags]} connected={false} onAction={() => unavailable(app)} onDetails={() => setDetail(app)}/>)}
      </div>
      {!visibleInstalled.length && !visibleExamples.length && <div className="catalog-empty"><Search size={28}/><h3>{installedOnly ? "没有符合条件的已安装应用" : "没有找到相关应用"}</h3><p>{installedOnly ? "取消“已安装”，探索更多应用。" : "试试应用名称、分类或想完成的事。"}</p><button className="button secondary" onClick={() => {setQuery("");setCategory("all");setInstalledOnly(false);}}>查看所有应用</button></div>}
    </div></div>
    {detail && <AppDetails app={exampleDetails(detail)} onClose={closeDetail} onAction={() => unavailable(detail)}/>}
  </div>;
}
