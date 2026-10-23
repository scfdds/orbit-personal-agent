import AppCatalogCard from "./AppCatalogCard.tsx";

const examples = [
  { name: "美图设计室", description: "全能 AI 设计工具", mark: "design", tags: ["营销素材", "画布编辑"] },
  { name: "企鹅教师助手", description: "懂教学，更懂你的教学助理", mark: "teaching", tags: ["备课", "练习与学情"] },
  { name: "通达信", description: "证券智能投研交易助手", mark: "market", tags: ["公司比较", "数据溯源"] },
  { name: "腾讯自选股", description: "专业伴你成长，让投资更从容", mark: "watchlist", tags: ["关注列表", "公告跟踪"] },
  { name: "腾讯电子签AI合同助手", description: "懂合同的 Agent，一键养成", mark: "signature", tags: ["条款审阅", "修订对照"] },
  { name: "Alpha派", description: "人手一个的 AI 投研神器", mark: "research", tags: ["研报阅读", "观点核验"] },
];

export default function EcosystemApps({ onNotify }: { onNotify: (message: string) => void }) {
  const unavailable = (name: string) => onNotify(`${name}暂不能安装，当前为展示用应用。`);
  return (
    <section className="ecosystem-section" aria-label="探索生态应用">
      <div className="app-section-heading">
        <h2>探索应用</h2>
        <p>发现设计、教学、合同与投研应用。以下为生态示例，尚未接入 Orbit。</p>
      </div>
      <div className="app-directory">
        {examples.map((app) => (
          <AppCatalogCard key={app.name} {...app} connected={false}
            onAction={() => unavailable(app.name)} onDetails={() => unavailable(app.name)} />
        ))}
      </div>
    </section>
  );
}
