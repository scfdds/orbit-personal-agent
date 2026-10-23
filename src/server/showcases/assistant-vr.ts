import { OrbitStore, now } from "../store.ts";

/** Authored reference material, never represented as an imported real conversation. */
export function seedAssistantVrShowcase(store: OrbitStore) {
  const marker = "showcase:orbit-next-vr:v1";
  if (store.metadata(marker)) return;
  store.transaction(() => {
    if (!store.get("conversations", "orbit-next-vr")) {
      const conversation = store.createConversation("VR 助手：从桌面延展到空间", {
        id: "orbit-next-vr", project: "产品探索",
        showcase: { title: "VR 助手方案示例", period: "2026-10", notice: "根据本轮产品讨论整理的示例资料，并非导入的原始聊天记录。" },
        summary: "同一主助手协作，按事项保留独立 Session 与可回访工作现场；先验证桌面交互，再探索空间增强。",
      });
      const rounds = [
        ["我希望与同一个助手交流，每件事又有自己的窗口、对话和可以回访的现场。", "可以保留一个持续的主对话，让助手搜索、读取并打开各事项的原对话。每件事继续拥有独立 Session、应用对象与成果；主对话负责协作，右侧工作区承载当前需要查看的资料。打开旧对话只做查看，不自动向其中发送消息或重新执行旧任务。"],
        ["先从已有的 PC 桌面办公体验出发，之后再考虑 Swan 上的空间体验。", "先在 PC 端验证‘主对话提出要求—打开历史材料—生成并展示成果—回访原事项’。业务状态与执行继续复用 Orbit 后端；空间外壳随后探索 WebSpatial 增强。多窗口位置、布局和现场恢复需要另外设计，这份示例没有宣称已接入或验证具体硬件能力。"],
        ["语音交流时，希望反馈简短，但完整成果还要能看。", "主助手用简短语音或文字交代进展和结果，详细方案保存成可阅读的产物。语音不是把长报告全部朗读一遍；是否打断、如何确认以及何时展示窗口，需要通过实际交互验证。当前原型仍使用文字输入与回复。"],
        ["接下来最需要验证的操作是什么？", "让用户一直在主对话说‘继续 VR 助手方案’，由助手找到并打开这段参考对话；再根据明确选中的材料保存一份真实 Markdown 方案，产物归属 VR 助手事项。用户手动关闭右侧窗口后，刷新不能使旧窗口自己弹回。只有明确要求保存回对话时，才追加精炼成果，不把主对话全文自动复制过去。"],
      ];
      const sourceIds: string[] = [];
      for (const [question, answer] of rounds) {
        store.addMessage(conversation.id, "user", question!);
        sourceIds.push(store.addMessage(conversation.id, "assistant", answer!).id);
      }
      store.put("memories", {
        id: conversation.id, conversationId: conversation.id, version: 1, status: "ready", updatedAt: now(),
        summary: "VR 助手以同一主对话组织多件事，每件事保留独立 Session、原始讨论和真实产物。右侧按需打开材料；查看旧对话不会恢复旧任务。\n先在 PC 验证打开历史、生成归属明确的成果和关闭后可控恢复，再探索 WebSpatial 空间窗口。语音反馈宜简短，完整方案留在可阅读的产物里。\n待验证：用户从主对话继续 VR 方案时，能否找到原对话并生成真实 Markdown；窗口关闭后不自动重开；仅在明确要求时写回成果。",
        items: [
          { id: "vr-assistant-entry", kind: "idea", text: "同一主对话管理多个独立事项，右侧用于资料与成果，打开不等于执行。", sourceIds: [sourceIds[0]!] },
          { id: "vr-pc-first", kind: "idea", text: "先验证 PC 工作流，再探索 WebSpatial 空间增强；当前没有硬件接入验证。", sourceIds: [sourceIds[1]!] },
          { id: "vr-next-check", kind: "question", text: "待验证主对话打开旧资料后生成真实产物、正确归属，并尊重用户关闭窗口。", sourceIds: [sourceIds[3]!] },
        ],
      });
    }
    store.setMetadata(marker, true);
  });
}
