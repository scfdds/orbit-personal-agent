import { useEffect, useState } from "react";
import {
  Columns3,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Link2,
  Check,
  SlidersHorizontal,
  Combine,
  FileText,
} from "lucide-react";
import type { AppPanelProps } from "../../client/panel-types.ts";
import type { FeedbackItem, Opportunity } from "../../shared/types.ts";

export default function OpportunitiesPanel({
  object,
  objects,
  onUpdate,
  onSend,
  onOpenApp,
}: AppPanelProps) {
  const items = (object?.data.items ?? []) as Opportunity[];
  const [focus, setFocus] = useState(String(object?.data.focus ?? ""));
  const [editingFocus, setEditingFocus] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullDescriptions, setFullDescriptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const feedback = objects.find(
    (o) =>
      o.appId === "feedback" && o.conversationId === object?.conversationId,
  );
  const feedbackItems = (feedback?.data.items ?? []) as FeedbackItem[];
  useEffect(() => {
    if (!editingFocus) setFocus(String(object?.data.focus ?? ""));
  }, [object?.version, object?.id, editingFocus]);
  useEffect(() => {
    setSelected([]);
    setExpanded(null);
  }, [object?.id]);
  async function update(data: Record<string, unknown>) {
    if (!object) return false;
    setBusy(true);
    setSaveError("");
    try {
      await onUpdate(object, data);
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const setItem = (id: string, patch: Partial<Opportunity>) =>
    update({
      ...object!.data,
      items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  async function proceed(text: string) {
    if (busy) return;
    if (editingFocus && object) {
      if (!(await update({ ...object.data, focus }))) return;
      setEditingFocus(false);
    }
    onSend(text);
  }
  return (
    <div className="app-surface opportunities-app">
      <div className="app-heading">
        <div className="app-eyebrow">
          <Columns3 size={15} />
          <span>机会看板</span>
          <span className="sample-tag">示例项目</span>
        </div>
        <h2>把反馈变成下一步</h2>
        <p>调整判断，Orbit 会沿着新的方向继续。</p>
      </div>
      <div className="focus-block">
        <div className="field-heading">
          <SlidersHorizontal size={13} />
          <label htmlFor="board-focus">本轮关注方向</label>
        </div>
        <textarea
          id="board-focus"
          value={focus}
          placeholder="例如：先改善已有功能的使用体验"
          rows={2}
          onChange={(e) => {
            setFocus(e.target.value);
            setEditingFocus(true);
          }}
          onBlur={() => {
            if (object && focus !== object.data.focus)
              void update({ ...object.data, focus }).then((saved) => {
                if (saved) setEditingFocus(false);
              });
            else setEditingFocus(false);
          }}
        />
        <span className="field-hint">
          {saveError ||
            (editingFocus
              ? "当前修改尚未保存 · 离开输入框保存"
              : "离开输入框自动保存")}
        </span>
        {saveError && (
          <button
            className="text-button"
            onClick={() => {
              if (object)
                void update({ ...object.data, focus }).then((saved) => {
                  if (saved) setEditingFocus(false);
                });
            }}
          >
            重试保存
          </button>
        )}
      </div>
      <div className="board-section-heading">
        <span>
          产品机会 <small>{items.length}</small>
        </span>
        <span className="muted">优先级由你决定</span>
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>已选 {selected.length} 项</span>
          <button
            className="text-button"
            disabled={selected.length < 2 || busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              void proceed(
                `请读取最新机会看板，将 ${selected.join("、")} 合并成一个问题，保留关联反馈证据，并尊重我已设置的优先级和关注方向。`,
              );
              setSelected([]);
            }}
          >
            <Combine size={14} />让 Orbit 合并
          </button>
          <button className="quiet-button" onClick={() => setSelected([])}>
            取消
          </button>
        </div>
      )}
      <div className="opportunity-list">
        {items.map((item) => (
          <article
            key={item.id}
            className={`opportunity-card ${selected.includes(item.id) ? "card-selected" : ""}`}
          >
            <div className="opportunity-top">
              <label className="card-checkbox">
                <input
                  type="checkbox"
                  aria-label={`选择 ${item.title}`}
                  checked={selected.includes(item.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
              </label>
              <select
                className={`priority priority-${item.priority.toLowerCase()}`}
                aria-label={`${item.title}的优先级`}
                value={item.priority}
                disabled={busy}
                onChange={(e) =>
                  void setItem(item.id, {
                    priority: e.target.value as Opportunity["priority"],
                  })
                }
              >
                <option>P0</option>
                <option>P1</option>
                <option>P2</option>
              </select>
              <select
                className="opportunity-status"
                aria-label={`${item.title}的状态`}
                value={item.status}
                disabled={busy}
                onChange={(e) =>
                  void setItem(item.id, {
                    status: e.target.value as Opportunity["status"],
                  })
                }
              >
                <option value="proposed">待讨论</option>
                <option value="planned">已纳入计划</option>
                <option value="watching">持续观察</option>
              </select>
              <ChevronDown size={12} />
            </div>
            <h3>{item.title}</h3>
            <p
              className={
                fullDescriptions.includes(item.id) ? "" : "card-description"
              }
            >
              {item.description}
            </p>
            {item.description.length > 120 && (
              <button
                className="description-toggle"
                onClick={() =>
                  setFullDescriptions(
                    fullDescriptions.includes(item.id)
                      ? fullDescriptions.filter((id) => id !== item.id)
                      : [...fullDescriptions, item.id],
                  )
                }
              >
                {fullDescriptions.includes(item.id) ? "收起详情" : "展开详情"}
              </button>
            )}
            <div className="opportunity-bottom">
              <button
                onClick={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
                className="evidence-button"
              >
                <Link2 size={13} />
                {item.feedbackIds.length} 条关联反馈
                {expanded === item.id ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
              <span className="category-label">{item.category}</span>
            </div>
            {expanded === item.id && (
              <div className="evidence-list">
                {item.feedbackIds.map((id) => {
                  const evidence = feedbackItems.find((f) => f.id === id);
                  return (
                    <div key={id}>
                      <span>{id}</span>
                      <p>{evidence?.text ?? "该条证据暂不可用"}</p>
                      {evidence?.excluded && <small>已被用户排除</small>}
                    </div>
                  );
                })}
                <button
                  className="text-button"
                  onClick={() => onOpenApp("feedback", feedback?.id)}
                >
                  打开反馈台
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </article>
        ))}
        {!items.length && (
          <div className="panel-empty">
            <Columns3 size={29} />
            <p>还没有产品机会</p>
            <button
              className="button secondary"
              onClick={() =>
                onSend("分析反馈台中的有效反馈，创建产品机会看板，并打开看板。")
              }
            >
              让 Orbit 开始分析
            </button>
          </div>
        )}
      </div>
      <div className="board-footer">
        <span>
          <Check size={13} />
          {busy
            ? "正在保存…"
            : saveError || editingFocus
              ? "有未保存的修改"
              : `已保存${object ? ` · v${object.version}` : ""}`}
        </span>
        <button
          className="text-button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            void proceed(
              "请读取我刚修改的机会看板和反馈台，按当前关注方向、优先级和排除项重新分析，保留我的决策，并生成一份产品改进说明文档。",
            )
          }
          disabled={busy}
        >
          按当前条件继续
          <ArrowUpRight size={14} />
        </button>
      </div>
      <button
        disabled={busy}
        className="report-link"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          void proceed(
            "读取最新机会看板和关联反馈，生成一份简短的产品改进说明，使用 save_report 保存为文档。",
          )
        }
      >
        <FileText size={14} />
        生成改进说明
      </button>
    </div>
  );
}
