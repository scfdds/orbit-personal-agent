import type { AppManifest } from "../shared/types.ts";

export type AppCategory = NonNullable<AppManifest["category"]>;
export const appCategories: { id: AppCategory; label: string }[] = [
  { id: "productivity", label: "效率办公" }, { id: "finance", label: "金融投研" },
  { id: "legal", label: "法律事务" }, { id: "design", label: "设计创作" },
  { id: "research", label: "学习研究" }, { id: "education", label: "教育教学" },
  { id: "development", label: "开发工具" }, { id: "lifestyle", label: "生活出行" },
];
export type CapabilityType = "app" | "skill" | "mcp";
export const capabilityTypes: {id: CapabilityType; label: string}[] = [{id:"app",label:"交互应用"},{id:"skill",label:"仅 Skills"},{id:"mcp",label:"仅 MCP"}];
export const capabilityLabel = (type: CapabilityType) => capabilityTypes.find(item => item.id === type)!.label;
export interface CapabilityItem { name: string; description: string }
export interface CatalogExample {
  id: string; name: string; description: string; mark: string; category: AppCategory;
  tags: string[]; publisher: string; workflow: string[];
  capabilityType?: CapabilityType; version?: string; skills?: CapabilityItem[]; mcpServers?: CapabilityItem[];
}
// These are catalog concepts only. They are never returned as installed tools.
const examples: CatalogExample[] = [
  { id:"meitu",name:"美图设计室",description:"从一句创意到一组营销素材，在画布中继续调整文字、构图与尺寸。",mark:"design",category:"design",tags:["营销素材","画布编辑"],publisher:"生态应用示例",workflow:["描述设计需求与使用场景","在画布中选择并调整方案","按渠道尺寸导出素材"] },
  { id:"teacher",name:"企鹅教师助手",description:"围绕课程目标准备教案与练习，把学情和教学材料放在一起。",mark:"teaching",category:"education",tags:["备课","练习生成"],publisher:"生态应用示例",workflow:["选择学科与教学目标","组织教案和练习","结合学情调整内容"] },
  { id:"tdx",name:"通达信",description:"汇集行情、公告与研究资料，在同一个视图核对观察线索。",mark:"market",category:"finance",tags:["市场观察","公告检索"],publisher:"生态应用示例",workflow:["选择关注标的","核对行情与公告来源","整理观察记录"] },
  { id:"watchlist",name:"腾讯自选股",description:"管理自选清单，跟进公司公告与重要事件，保留自己的观察。",mark:"watchlist",category:"finance",tags:["自选清单","事件跟踪"],publisher:"生态应用示例",workflow:["导入自选清单","查看公司动态","整理关注事项"] },
  { id:"signature",name:"腾讯电子签 AI 合同助手",description:"整理合同要点与修改意见，在签署前逐项核对约定。",mark:"signature",category:"legal",tags:["合同要点","修订核对"],publisher:"生态应用示例",workflow:["导入合同","核对条款和修改意见","准备签署材料"] },
  { id:"alpha",name:"Alpha派",description:"阅读研报、对比观点，将结论和原始来源一起留存。",mark:"research",category:"finance",tags:["研报阅读","观点对比"],publisher:"生态应用示例",workflow:["选择研究主题","阅读资料并核对证据","形成带来源的研究笔记"] },
  { id:"meetnote",name:"会记",description:"从会议记录提取决定和行动项，逐条确认负责人及后续安排。",mark:"meeting",category:"productivity",tags:["会议纪要","行动项"],publisher:"Orbit 概念应用",workflow:["导入会议记录","确认结论和待办","导出会议纪要"] },
  { id:"sheets",name:"数表",description:"清洗 CSV、筛选异常数据，在可编辑表格中完成分析。",mark:"sheets",category:"productivity",tags:["表格分析","数据清洗"],publisher:"Orbit 概念应用",workflow:["导入表格","检查字段与异常值","生成图表和分析结果"] },
  { id:"slides",name:"轻演示",description:"从资料生成演示提纲，逐页调整内容、图表和叙事顺序。",mark:"slides",category:"design",tags:["演示文稿","逐页编辑"],publisher:"Orbit 概念应用",workflow:["提供资料和演示对象","确认提纲并编辑页面","导出幻灯片"] },
  { id:"papers",name:"论文书架",description:"把论文、摘录和问题放在一处，沿着引用继续研究。",mark:"papers",category:"research",tags:["文献阅读","引用管理"],publisher:"Orbit 概念应用",workflow:["收集论文","对照方法与结论","整理引用和阅读笔记"] },
  { id:"casefinder",name:"案例研读",description:"围绕争议问题整理检索条件、案例摘录与待核实信息。",mark:"law",category:"legal",tags:["案例整理","资料溯源"],publisher:"Orbit 概念应用",workflow:["明确争议问题","整理相关资料","核对来源和适用范围"] },
  { id:"evidence",name:"证据整理台",description:"整理图片、聊天记录与文件，建立可追溯的材料目录。",mark:"scan",category:"legal",tags:["材料归档","文字提取"],publisher:"Orbit 概念应用",workflow:["导入材料","核对提取内容","按事件整理材料目录"] },
  { id:"repo",name:"代码协作",description:"汇总仓库问题、变更和检查结果，跟进一次开发任务。",mark:"code",category:"development",tags:["代码仓库","变更审阅"],publisher:"Orbit 概念应用",workflow:["连接代码仓库","选择问题并检查变更","整理审阅意见"] },
  { id:"api",name:"接口实验室",description:"组织接口请求与环境参数，把调试结果变成可复用的测试。",mark:"api",category:"development",tags:["接口调试","请求集合"],publisher:"Orbit 概念应用",workflow:["导入接口定义","填写参数并调试","保存请求与测试结果"] },
  { id:"reader",name:"双语阅读",description:"对照原文理解外语资料，保留术语、摘录和自己的批注。",mark:"language",category:"research",tags:["双语对照","术语笔记"],publisher:"Orbit 概念应用",workflow:["导入原文","逐段对照理解","保存术语与笔记"] },
  { id:"practice",name:"练习工坊",description:"围绕知识薄弱点组织练习，用错题和反馈安排下一次学习。",mark:"practice",category:"education",tags:["专项练习","错题整理"],publisher:"Orbit 概念应用",workflow:["选择学习主题","完成练习并核对","整理错题和复习安排"] },
  { id:"recipe",name:"餐桌计划",description:"根据食材和口味安排一周菜单，汇总成可勾选的采购清单。",mark:"recipe",category:"lifestyle",tags:["菜单规划","采购清单"],publisher:"Orbit 概念应用",workflow:["填写食材与偏好","调整一周菜单","确认采购清单"] },
];

const lightweight: CatalogExample[] = [
 {id:"research-skill",name:"研究方法",description:"帮助 Agent 拆解研究问题、比较来源，并把事实与推断分开。",mark:"papers",category:"research",tags:["问题拆解","来源核对"],publisher:"知序研究社",capabilityType:"skill",workflow:["把一个宽泛问题拆成可验证的问题","按证据组织研究结论"],skills:[{name:"research-method",description:"定义研究步骤、来源质量要求和结论格式。"}]},
 {id:"writing-skill",name:"清晰写作",description:"为 Agent 提供写作与修改方法，让文稿结构清楚、表达简洁。",mark:"language",category:"productivity",tags:["结构梳理","文字修改"],publisher:"简文工作室",capabilityType:"skill",workflow:["将零散笔记整理成文章","检查重复表述和逻辑跳跃"],skills:[{name:"clear-writing",description:"按读者、目的、结构与语言四个步骤检查文稿。"}]},
 {id:"review-skill",name:"代码审阅规范",description:"让 Agent 按一致的检查清单审阅代码，给出可定位、可验证的问题。",mark:"code",category:"development",tags:["审阅规范","风险检查"],publisher:"Northstar Dev",capabilityType:"skill",workflow:["检查一次代码变更","整理问题位置与验证建议"],skills:[{name:"review-checklist",description:"提供正确性、边界条件和可维护性的审阅准则。"}]},
 {id:"repo-mcp",name:"仓库连接器",description:"向 Agent 提供仓库、议题与变更的读取能力，通过对话查询开发动态。",mark:"code",category:"development",tags:["仓库读取","议题检索"],publisher:"Bridge Tools",capabilityType:"mcp",workflow:["查找某个仓库的待处理议题","读取变更内容并汇总进展"],mcpServers:[{name:"repository-mcp",description:"拟提供 list_repositories、search_issues、read_change 等工具。"}]},
 {id:"database-mcp",name:"数据库连接器",description:"让 Agent 查询授权的数据表与结构，支持只读分析。",mark:"sheets",category:"development",tags:["只读查询","结构发现"],publisher:"DataDock",capabilityType:"mcp",workflow:["了解数据库的表与字段","按问题查询并解释数据"],mcpServers:[{name:"database-mcp",description:"拟提供 list_tables、describe_table、query_readonly 等工具。"}]},
 {id:"search-mcp",name:"网页检索连接器",description:"为 Agent 提供网页搜索与正文读取能力，返回可追溯的来源。",mark:"research",category:"research",tags:["网页搜索","正文读取"],publisher:"Open Trail",capabilityType:"mcp",workflow:["检索一个主题的原始来源","读取页面并比较资料"],mcpServers:[{name:"web-search-mcp",description:"拟提供 search、read_page 等工具及来源地址。"}]},
];
const conceptDevelopers: Record<string,string> = {meetnote:"拾光软件",sheets:"DataDock",slides:"纸飞机设计",papers:"知序研究社",casefinder:"明理工作室",evidence:"明理工作室",repo:"Northstar Dev",api:"Bridge Tools",trip:"漫游工作室",reader:"简文工作室",practice:"青芽学习",recipe:"日常实验室"};
const orderedExamples: CatalogExample[] = [
  { id:"trip",name:"行程手册",description:"把地点、交通和预订放进一份行程，按天调整出行安排。",mark:"travel",category:"lifestyle",tags:["行程规划","地点清单"],publisher:"Orbit 概念应用",workflow:["设定目的地与预算","整理交通和住宿","确认每日行程"] },...examples, ...lightweight];
export const catalogExamples: CatalogExample[] = orderedExamples.map(app => ({
 ...app, capabilityType: app.capabilityType || "app", version: app.version || "1.0.0",
 publisher: conceptDevelopers[app.id] || app.publisher,
 skills: app.skills || [{name:`${app.id}-workflow`,description:`围绕${app.tags.join("与")}的任务方法与操作指南。`}],
 mcpServers: app.mcpServers || (app.capabilityType === "skill" ? [] : [{name:`${app.id}-mcp`,description:`拟提供${app.tags.join("、")}相关的工具与数据访问。`}]),
})).map(app => app.capabilityType === "mcp" ? {...app,skills:[]} : app);

export interface AppDetailData {
 id: string; name: string; description: string; mark: string; capabilityType: CapabilityType;
 publisher: string; version: string; connected: boolean; category?: string;
 skills: CapabilityItem[]; mcpServers: CapabilityItem[]; tools: CapabilityItem[];
 useCases: string[]; permissions: string[];
}
export function installedDetails(app: AppManifest): AppDetailData {
 return {id:app.id,name:app.name,description:app.description,mark:app.id,capabilityType:"app",publisher:app.publisher || "Orbit Labs",version:app.version,connected:true,category:app.category,skills:[],mcpServers:[],tools:app.tools,useCases:app.starterPrompts || app.capabilities,permissions:app.permissions};
}
export function exampleDetails(app: CatalogExample): AppDetailData {
 return {...app,capabilityType:app.capabilityType || "app",version:app.version || "1.0.0",connected:false,skills:app.skills || [],mcpServers:app.mcpServers || [],tools:[],useCases:app.workflow,permissions:[]};
}

export function categoryLabel(id?: string) { return appCategories.find(c => c.id === id)?.label || "效率办公"; }
export function matchesApp(query: string, app: {name:string; description:string; tags?:string[]; capabilities?:string[]; category?:string; publisher?:string; capabilityType?:CapabilityType}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const haystack = [app.name, app.description, app.publisher || "", capabilityLabel(app.capabilityType || "app"), ...(app.tags || app.capabilities || []), categoryLabel(app.category)].join(" ").toLocaleLowerCase();
  return terms.every(term => haystack.includes(term));
}
