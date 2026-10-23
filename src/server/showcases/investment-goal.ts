import { OrbitStore } from "../store.ts";
import type { Work } from "../../shared/types.ts";

const marker = "showcase:investment-goal:v1";
const goal = "围绕 AI 算力相关持仓，持续核验云厂商资本开支、产业供需与公司财报是否改变原有投资判断。有重要新事实时附来源提醒，每周五整理一次复盘；区分事实与推测，没有重要变化时不打扰。每天自检资料和任务是否正常，发现遗漏就补充安排，持续跟踪到我要求停止。";

const showcase: NonNullable<Work["showcase"]> = {
  clock: "2026-09-25T16:00:00+08:00",
  notice: "示例回放 · 9 月 25 日 16:00 · 以下行动为演示内容，未启用自动执行或实时行情。",
  entries: [
    { id: "health-23", at: "2026-09-23T08:30:00+08:00", finishedAt: "2026-09-23T08:30:42+08:00", title: "每日自检", cadence: "每天", state: "done",
      summary: "资料与跟踪任务正常，没有待补充的安排。", detail: "沿用现有关注范围，保留下午的重要变化核验。",
      steps: [{ at: "2026-09-23T08:30:00+08:00", title: "读取目标与待办" }, { at: "2026-09-23T08:30:20+08:00", title: "检查资料更新时间" }, { at: "2026-09-23T08:30:42+08:00", title: "确认定时任务正常" }] },
    { id: "review-23", at: "2026-09-23T15:30:00+08:00", finishedAt: "2026-09-23T15:32:10+08:00", title: "核对今日重要变化", cadence: "每个交易日", state: "done",
      summary: "已整理新增材料，暂无改变持仓依据的重要事实。", detail: "重复转载已合并；新增信息保留出处，纳入周五复盘。",
      steps: [{ at: "2026-09-23T15:30:00+08:00", title: "读取新增材料" }, { at: "2026-09-23T15:31:10+08:00", title: "合并重复信息、核对原始出处" }, { at: "2026-09-23T15:32:10+08:00", title: "更新本周复盘材料" }] },
    { id: "health-24", at: "2026-09-24T08:30:00+08:00", finishedAt: "2026-09-24T08:30:38+08:00", title: "每日自检", cadence: "每天", state: "done",
      summary: "昨日核验已完成，今日安排正常。", detail: "暂无遗漏或失败任务，无需追加行动。",
      steps: [{ at: "2026-09-24T08:30:00+08:00", title: "核对昨日执行结果" }, { at: "2026-09-24T08:30:38+08:00", title: "检查今日安排与资料状态" }] },
    { id: "review-24", at: "2026-09-24T15:30:00+08:00", finishedAt: "2026-09-24T15:31:50+08:00", title: "核对今日重要变化", cadence: "每个交易日", state: "done",
      summary: "新增材料已归档，维持原有跟踪重点。", detail: "未发现需要提醒的重要变化，继续关注资本开支、供需与财报披露。",
      steps: [{ at: "2026-09-24T15:30:00+08:00", title: "核对新增披露与已有材料" }, { at: "2026-09-24T15:31:50+08:00", title: "记录结论与后续关注点" }] },
    { id: "health", at: "2026-09-25T08:30:00+08:00", finishedAt: "2026-09-25T08:31:12+08:00",
      steps: [{ at: "2026-09-25T08:30:00+08:00", title: "读取目标与近期执行记录" }, { at: "2026-09-25T08:30:26+08:00", title: "检查资料更新", detail: "公告资料停留在前一天。" }, { at: "2026-09-25T08:30:54+08:00", title: "追加 09:00 公告补查" }, { at: "2026-09-25T08:31:12+08:00", title: "确认其余安排正常" }], title: "每日自检", cadence: "每天", state: "done",
      summary: "发现公告资料未更新，已安排 09:00 补查。其余跟踪正常。",
      detail: "公告资料停留在前一天，已追加一次补查。其余任务正常；本次只留记录，无需提醒。" },
    { id: "backfill", at: "2026-09-25T09:00:00+08:00", finishedAt: "2026-09-25T09:02:35+08:00",
      steps: [{ at: "2026-09-25T09:00:00+08:00", title: "读取公告资料缺口" }, { at: "2026-09-25T09:01:20+08:00", title: "核对发布日期与原始出处" }, { at: "2026-09-25T09:02:35+08:00", title: "补齐资料并更新检查时间" }], title: "补查关注公司的公告", addedBy: "每日自检追加", state: "done",
      summary: "已补齐遗漏资料。未发现需要调整原判断的新事实。",
      detail: "资料检查时间已更新。新增内容与已有判断一致，保留原跟踪范围。" },
    { id: "review", at: "2026-09-25T15:30:00+08:00", finishedAt: "2026-09-25T15:33:08+08:00",
      steps: [{ at: "2026-09-25T15:30:00+08:00", title: "整理今日新增材料" }, { at: "2026-09-25T15:31:45+08:00", title: "核对信息依据", detail: "“需求上修”的转述缺少原始披露，保留待核实。" }, { at: "2026-09-25T15:33:08+08:00", title: "安排晚间进一步核验" }], title: "核对今日重要变化", cadence: "每个交易日", state: "done",
      summary: "一条“需求上修”的转述缺少原始依据，留待晚间核实。",
      detail: "暂不将未经证实的转述作为事实。已安排 18:00 查找原始披露，核对时间和统计口径，再判断与持仓的关联。" },
    { id: "verify", at: "2026-09-25T18:00:00+08:00", title: "核实待确认的信息", addedBy: "今日核对追加", state: "planned",
      summary: "回到公告与原始来源，判断“需求上修”是否成立、是否影响持仓依据。",
      detail: "找到一手依据后记录出处与结论；找不到则保留“待核实”，不强行下结论。只有改变原有判断的重要事实才提醒用户。" },
    { id: "weekly", at: "2026-09-25T20:00:00+08:00", title: "整理本周持仓复盘", cadence: "每周五", state: "planned",
      summary: "汇总本周新事实、原判断的变化，以及下周需要验证的事项。",
      detail: "复盘沿用同一份持仓依据，逐项对照新增证据。未完成的核验继续保留，附下一步行动。" },
    { id: "health-next", at: "2026-09-26T08:30:00+08:00", title: "每日自检", cadence: "每天", state: "planned",
      summary: "检查资料更新与任务执行情况，补上遗漏；一切正常就安静继续。",
      detail: "检查昨晚核验与每周复盘是否完成，失败的安排是否需要重试，是否出现新的待办条件。每天自检用于保证目标持续推进，不重复生成一份行情日报。" },
  ],
};

/** Upgrade an untouched sample only. Keep real work/history and never seed live triggers. */
export function seedInvestmentGoal(store: OrbitStore) {
  if (store.metadata(marker)) return upgradeInvestmentHistory(store);
  return store.transaction(() => {
    const prior = store.get("works", "daily-goal-holdings");
    const untouched = prior?.title === "持仓观察与每周复盘" &&
      prior.goal === "围绕实际持仓记录重要财报、业务变化与原判断的变化，附来源，避免日常涨跌噪声。" &&
      prior.summary === "跟踪框架已建立，待补充真实持仓与资料来源" &&
      prior.status === "needs_input" && !prior.completionCriteria &&
      !store.list("runs").some(r => r.workId === prior.id) &&
      !store.list("triggers").some(t => t.workId === prior.id);
    if (untouched) {
      store.updateWork(prior.id, { title: "AI 算力持仓跟踪", goal, showcase,
        summary: "投资场景示例；接入真实资料后可在对话中安排执行。" });
    } else {
      if (store.get("works", "investment-goal-demo") || store.get("conversations", "investment-goal-demo"))
        throw new Error("投资示例 ID 已存在，未覆盖已有内容");
      const conversation = store.createConversation("AI 算力持仓：持续跟踪示例", {
        id: "investment-goal-demo", project: "投资观察",
        showcase: { title: "长期目标示例", period: "2026-09-25", notice: showcase.notice },
      });
      store.createWork(conversation.id, "AI 算力持仓跟踪", goal, {
        id: "investment-goal-demo", showcase,
        summary: "投资场景示例；接入真实资料后可在对话中安排执行。",
      });
    }
    store.setMetadata(marker, true);
    store.setMetadata("showcase:investment-history:v2", true);
    return true;
  });
}

/** Add authored history to the existing preview without touching user goals or execution records. */
function upgradeInvestmentHistory(store: OrbitStore) {
  if (store.metadata("showcase:investment-history:v2")) return false;
  return store.transaction(() => {
    for (const id of ["daily-goal-holdings", "investment-goal-demo"]) {
      const work = store.get("works", id);
      if (!work?.showcase || work.showcase.clock !== showcase.clock) continue;
      const entries = work.showcase.entries.map(entry => {
        const template = showcase.entries.find(e => e.id === entry.id && e.at === entry.at && e.title === entry.title && e.summary === entry.summary);
        return template && !entry.steps ? { ...entry, detail: template.detail, steps: template.steps, finishedAt: template.finishedAt } : entry;
      });
      for (const entry of showcase.entries.filter(e => e.at < "2026-09-25")) {
        if (!entries.some(e => e.id === entry.id)) entries.push(entry);
      }
      entries.sort((a, b) => a.at.localeCompare(b.at));
      store.updateWork(id, { showcase: { ...work.showcase, entries } });
    }
    store.setMetadata("showcase:investment-history:v2", true);
    return true;
  });
}
