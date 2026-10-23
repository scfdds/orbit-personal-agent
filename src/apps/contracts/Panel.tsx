import { useEffect, useRef, useState } from "react";
import {
  FileCheck2,
  Upload,
  ArrowUpRight,
  Check,
  X,
  Download,
  Pencil,
  Undo2,
  FileText,
} from "lucide-react";
import type { AppPanelProps } from "../../client/panel-types.ts";
import {
  importContract,
  sampleContract,
  type ContractData,
  type ContractSuggestion,
} from "./data.ts";

const contractDrafts: Record<string, {text?: string; requirements?: string}> = {};

export default function ContractPanel({
  object,
  onUpdate,
  onSend,
  work,
}: AppPanelProps) {
  const data = object?.data as unknown as ContractData | undefined;
  const [tab, setTab] = useState<"review" | "source">("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState(Boolean(contractDrafts[work.id]?.text));
  const [text, setText] = useState(contractDrafts[work.id]?.text || "");
  const [requirements, setRequirements] = useState(data?.requirements || "");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const reviews = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRequirements(contractDrafts[work.id]?.requirements ?? data?.requirements ?? "");
  }, [object?.id, data?.requirements]);
  useEffect(() => {
    if (focused) {
      const container = tab === "source" ? source.current : reviews.current;
      container
        ?.querySelector<HTMLElement>(`[data-clause="${focused}"]`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [tab, focused]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function save(next: ContractData) {
    if (!object) throw new Error("合同应用尚未就绪，请刷新页面。");
    await onUpdate(object, next as unknown as Record<string, unknown>);
  }
  async function load(
    content: string,
    name: string,
    kind: "sample" | "paste" | "upload",
  ) {
    await save(importContract(content, name, kind));
    delete contractDrafts[work.id];
    setPaste(false);
    setText("");
    setTab("review");
    setFocused(null);
  }
  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("请选择 5 MB 以内的文档。");
    let content: string;
    if (/\.docx$/i.test(file.name)) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        arrayBuffer: await file.arrayBuffer(),
      });
      content = result.value;
    } else if (/\.(txt|md)$/i.test(file.name)) content = await file.text();
    else
      throw new Error("目前支持 .docx、.txt、.md；PDF 或扫描件请先转成文字。");
    await load(content, file.name.replace(/\.[^.]+$/, ""), "upload");
  }
  async function decide(
    s: ContractSuggestion,
    status: ContractSuggestion["status"],
    edited?: string,
  ) {
    if (!data) return;
    if (
      edited !== undefined &&
      (!edited.trim() || edited.trim() === s.original)
    )
      throw new Error("请填写实际修改后的条款。");
    await save({
      ...data,
      suggestions: data.suggestions.map((item) =>
        item.id === s.id
          ? {
              ...item,
              status,
              ...(edited !== undefined
                ? { proposed: edited.trim(), editedByUser: true }
                : {}),
            }
          : item,
      ),
    });
    setEditing(null);
  }
  const pending =
    data?.suggestions.filter((s) => s.status === "pending").length || 0;
  const accepted =
    data?.suggestions.filter((s) => s.status === "accepted").length || 0;
  const running = work.status === "running";
  const imported = Boolean(data?.clauses.length);
  function clauseTitle(id: string) {
    const index = data!.clauses.findIndex((c) => c.id === id);
    for (let i = index; i >= 0; i--) {
      const line = data!.clauses[i]!.text.split("\n")[0]!;
      if (/^第.{1,12}条/.test(line)) return line.slice(0, 35);
    }
    return `第 ${index + 1} 段`;
  }
  return (
    <div className="app-surface contract-app">
      <div className="app-heading">
        <div className="app-eyebrow">
          <FileCheck2 size={15} />
          <span>合同审阅</span>
          {data?.source === "sample" && (
            <span className="sample-tag">示例合同</span>
          )}
        </div>
        {imported && <h2>{data!.title}</h2>}
        <p>
          {imported
            ? "原文保留，修改由你逐条确认。"
            : "导入合同，按你的要求审阅条款，确认后导出修订稿。"}
        </p>
      </div>
      {error && (
        <p className="contract-error" role="alert">
          {error}
        </p>
      )}
      {!imported ? (
        <>
          <input
            ref={input}
            type="file"
            hidden
            accept=".docx,.txt,.md"
            aria-label="导入合同文件"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void perform(() => upload(file));
              e.target.value = "";
            }}
          />
          <button
            className="contract-upload"
            disabled={busy || !object}
            onClick={() => input.current?.click()}
          >
            <Upload size={24} />
            <strong>{busy ? "正在导入…" : "导入合同"}</strong>
            <span>Word / TXT / Markdown · 最大 5 MB</span>
          </button>
          <p className="contract-caption">
            Word
            提取正文，导出时重新排版；暂不保留原文件的批注、图片与复杂版式。
          </p>
          <div className="contract-start-actions">
            <button
              className="text-button"
              disabled={busy || !object}
              onClick={() => setPaste(!paste)}
            >
              粘贴合同正文
            </button>
            <button
              className="text-button"
              disabled={busy || !object}
              onClick={() =>
                void perform(() =>
                  load(sampleContract, "品牌设计服务合同", "sample"),
                )
              }
            >
              使用示例合同 <ArrowUpRight size={13} />
            </button>
          </div>
          {paste && (
            <div className="contract-paste">
              <textarea
                aria-label="合同正文"
                placeholder="在这里粘贴合同正文…"
                rows={10}
                maxLength={50000}
                value={text}
                onChange={(e) => {setText(e.target.value); contractDrafts[work.id] = {...contractDrafts[work.id], text:e.target.value};}}
              />
              <button
                className="button primary small"
                disabled={busy || !text.trim()}
                onClick={() =>
                  void perform(() => load(text, "导入的合同", "paste"))
                }
              >
                保存合同
              </button>
            </div>
          )}
        </>
      ) : (
        data && (
          <>
            <label className="contract-requirements">
              审阅要求
              <textarea
                aria-label="审阅要求"
                rows={3}
                maxLength={5000}
                value={requirements}
                onChange={(e) => {setRequirements(e.target.value); contractDrafts[work.id] = {...contractDrafts[work.id], requirements:e.target.value};}}
                placeholder="例如：我方为甲方，验收后 30 日付款，不接受单方涨价…"
              />
            </label>
            <div className="contract-review-action">
              <button
                className="button primary small"
                disabled={busy || running || !requirements.trim()}
                onClick={() =>
                  void perform(async () => {
                    if (requirements !== data.requirements)
                      await save({ ...data, requirements });
                    if (contractDrafts[work.id]) delete contractDrafts[work.id].requirements;
                    onSend(
                      `请按以下要求审阅当前合同：\n${requirements}\n\n请读取最新版本，保留我已经确认和手动编辑的内容。把需要调整的条款作为待确认建议放到右侧，说明修改理由，由我逐项决定。`,
                    );
                  })
                }
              >
                <ArrowUpRight size={14} />
                {running
                  ? "Orbit 正在处理"
                  : data.suggestions.length
                    ? "按最新要求复核"
                    : "交给 Orbit 审阅"}
              </button>
              <small>
                {requirements !== data.requirements
                  ? "审阅时会保存新要求"
                  : "以最新合同和你的决定继续"}
              </small>
            </div>
            <div className="contract-tabs" role="tablist" aria-label="合同内容">
              <button
                role="tab"
                aria-selected={tab === "review"}
                onClick={() => setTab("review")}
              >
                修改建议
                {data.suggestions.length > 0 && (
                  <span>{data.suggestions.length}</span>
                )}
              </button>
              <button
                role="tab"
                aria-selected={tab === "source"}
                onClick={() => setTab("source")}
              >
                合同原文
              </button>
            </div>
            {tab === "source" ? (
              <div className="contract-source" ref={source}>
                {data.clauses.map((clause) => (
                  <article
                    key={clause.id}
                    data-clause={clause.id}
                    className={focused === clause.id ? "focused" : ""}
                  >
                    <span>{clause.id}</span>
                    <p>{clause.text}</p>
                    {data.suggestions.some((s) => s.clauseId === clause.id) && (
                      <button
                        className="text-button"
                        onClick={() => setTab("review")}
                      >
                        查看修改建议
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="contract-suggestions" ref={reviews}>
                {data.suggestions.length === 0 ? (
                  <div className="contract-empty">
                    <FileText size={23} />
                    <p>
                      {running
                        ? "正在核对条款，建议会出现在这里。"
                        : "填写你的审阅要求，让 Orbit 开始核对。"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="contract-summary">
                      <span>{pending} 项待确认</span>
                      <span>{accepted} 项已采用</span>
                      <span>
                        {data.suggestions.length - pending - accepted} 项已忽略
                      </span>
                    </div>
                    {data.suggestions.map((s) => (
                      <article
                        className={`contract-suggestion ${s.status}`}
                        key={s.id}
                        data-clause={s.clauseId}
                      >
                        <div className="contract-suggestion-top">
                          <button
                            className="text-button"
                            onClick={() => {
                              setFocused(s.clauseId);
                              setTab("source");
                            }}
                          >
                            {clauseTitle(s.clauseId)} <ArrowUpRight size={12} />
                          </button>
                          <span>
                            {
                              {
                                pending: "待确认",
                                accepted: "已采用",
                                rejected: "已忽略",
                              }[s.status]
                            }
                            {s.editedByUser ? " · 你已编辑" : ""}
                          </span>
                        </div>
                        <details className="contract-reason">
                          <summary>修改原因</summary>
                          <p>{s.reason}</p>
                        </details>
                        <div className="contract-diff">
                          <div>
                            <small>原文</small>
                            <p>{s.original}</p>
                          </div>
                          <div>
                            <small>建议修改为</small>
                            {editing === s.id ? (
                              <textarea
                                aria-label={`编辑 ${s.clauseId} 的修改稿`}
                                rows={5}
                                value={draft}
                                maxLength={50000}
                                onChange={(e) => setDraft(e.target.value)}
                              />
                            ) : (
                              <p>{s.proposed}</p>
                            )}
                          </div>
                        </div>
                        <div className="contract-decisions">
                          {editing === s.id ? (
                            <>
                              <button
                                className="button secondary small"
                                disabled={busy}
                                onClick={() =>
                                  void perform(() =>
                                    decide(s, "accepted", draft),
                                  )
                                }
                              >
                                保存并采用
                              </button>
                              <button
                                className="quiet-button"
                                onClick={() => setEditing(null)}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              {s.status === "pending" ? (
                                <>
                                  <button
                                    className="button secondary small"
                                    disabled={busy}
                                    onClick={() =>
                                      void perform(() => decide(s, "accepted"))
                                    }
                                  >
                                    <Check size={13} />
                                    采用
                                  </button>
                                  <button
                                    className="quiet-button"
                                    disabled={busy}
                                    onClick={() =>
                                      void perform(() => decide(s, "rejected"))
                                    }
                                  >
                                    <X size={13} />
                                    忽略
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="quiet-button"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(() => decide(s, "pending"))
                                  }
                                >
                                  <Undo2 size={13} />
                                  撤销决定
                                </button>
                              )}
                              <button
                                className="quiet-button"
                                disabled={busy}
                                onClick={() => {
                                  setEditing(s.id);
                                  setDraft(s.proposed);
                                }}
                              >
                                <Pencil size={13} />
                                编辑
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </>
                )}
              </div>
            )}
            <div className="contract-export">
              <p>修订稿只合并已采用的修改，其余段落保留原文。</p>
              <div>
                <a
                  className="button secondary small"
                  href={`/api/conversations/${encodeURIComponent(work.id)}/apps/contracts/export/docx`}
                  download={`${data.title}-修订稿.docx`}
                >
                  <Download size={13} />
                  导出 Word
                </a>
                <a
                  className="quiet-button"
                  href={`/api/conversations/${encodeURIComponent(work.id)}/apps/contracts/export/md`}
                  download={`${data.title}-变更清单.md`}
                >
                  导出变更清单
                </a>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
