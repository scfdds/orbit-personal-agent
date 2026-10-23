import { useState } from "react";
import {
  Search,
  Inbox,
  ChevronDown,
  ArrowUpRight,
  Plus,
  Check,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";
import type { AppPanelProps } from "../../client/panel-types.ts";
import type { FeedbackItem } from "../../shared/types.ts";

export default function FeedbackPanel({
  object,
  onUpdate,
  onSend,
  onDemoEvent,
}: AppPanelProps) {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = (object?.data.items ?? []) as FeedbackItem[];
  const filtered = items.filter(
    (i) =>
      (showExcluded || !i.excluded) &&
      (segment === "all" || i.segment === segment) &&
      `${i.text} ${i.topic} ${i.customer}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function toggle(item: FeedbackItem) {
    if (!object) return;
    setBusy(true);
    try {
      await onUpdate(object, {
        ...object.data,
        items: items.map((i) =>
          i.id === item.id ? { ...i, excluded: !i.excluded } : i,
        ),
      });
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-surface feedback-app">
      <div className="app-heading">
        <div className="app-eyebrow">
          <Inbox size={15} />
          <span>反馈台</span>
          <span className="sample-tag">示例数据</span>
        </div>
        <h2>听见用户的声音</h2>
        <p>
          {items.filter((i) => !i.excluded).length}{" "}
          条有效反馈，作为分析的共同依据。
        </p>
      </div>
      <div className="app-actions">
        <button
          className="button secondary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDemoEvent();
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          <Plus size={14} />
          新增示例反馈
        </button>
        <button
          className="text-button"
          onClick={() =>
            onSend(
              "分析当前反馈台中的有效反馈，读取最新对象并更新产品机会看板。",
            )
          }
        >
          <span>交给 Orbit 分析</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="app-search">
        <Search size={15} />
        <input
          aria-label="搜索反馈"
          placeholder="搜索反馈内容、标签…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["new", "新用户"],
            ["active", "活跃用户"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={segment === value ? "selected" : ""}
              onClick={() => setSegment(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`filter-toggle ${showExcluded ? "active" : ""}`}
          title="显示已排除反馈"
          onClick={() => setShowExcluded(!showExcluded)}
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      <div className="feedback-list">
        {filtered.map((item) => (
          <article
            key={item.id}
            className={`feedback-item ${item.excluded ? "excluded" : ""}`}
          >
            <div className="feedback-meta">
              <span
                className={`source-icon source-${item.source.includes("访谈") ? "interview" : "default"}`}
              >
                <MessageSquare size={13} />
              </span>
              <span>{item.source}</span>
              <span className="dot-divider">·</span>
              <span>{item.segment === "new" ? "新用户" : "活跃用户"}</span>
              <span className="feedback-id">{item.id}</span>
            </div>
            <button
              className="feedback-content"
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            >
              {item.text}
            </button>
            <div className="feedback-bottom">
              <span className="topic-tag">{item.topic}</span>
              <button
                disabled={busy}
                className="quiet-button"
                onClick={() => void toggle(item)}
              >
                {item.excluded ? (
                  <>
                    <Check size={12} />
                    重新纳入
                  </>
                ) : (
                  "排除这条"
                )}
              </button>
            </div>
            {expanded === item.id && (
              <div className="feedback-expanded">
                <span>{item.customer}</span>
                <span>
                  {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <span>此条反馈来自演示数据集</span>
              </div>
            )}
          </article>
        ))}
        {!filtered.length && (
          <div className="panel-empty">
            <Inbox size={27} />
            <p>没有匹配的反馈</p>
            <button
              className="text-button"
              onClick={() => {
                setQuery("");
                setSegment("all");
                setShowExcluded(true);
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </div>
      <div className="app-footnote">
        <ChevronDown size={12} />
        修改会保存到当前任务，Orbit 下次读取时生效。
      </div>
    </div>
  );
}
