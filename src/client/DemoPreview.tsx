import { PanelRight, ChevronDown } from "lucide-react";
import type { Snapshot, Conversation } from "../shared/types.ts";
import { demoCases } from "../shared/demo-guide.ts";
import Sidebar from "./Sidebar.tsx";
import ChatView from "./ChatView.tsx";
import WorkspacePanel from "./WorkspacePanel.tsx";
const noop = () => {};
const done = async () => {};
const previewCase = demoCases.find(item => item.id === "portfolio")!;

/** Real product components, with no mutation callbacks or automatic executions. */
export default function DemoPreview({state, step}: {state: Snapshot; step: number}) {
  const work: Conversation = state.conversations.find(c => c.id === previewCase.conversationId)
    || state.conversations.find(c => !c.archived && !c.draft)
    || {id:"guide-preview",title:"新对话",project:"",pinned:false,archived:false,goal:"",status:"idle",summary:"",continuous:false,unread:false,createdAt:"",updatedAt:"",panel:null};
  return <div className={`orbit-app demo-preview demo-step-${step} with-workspace`} inert aria-hidden="true">
    <Sidebar state={state} selectedId={work.id} view="task" preview onGuide={noop} onView={noop} onSelect={noop} onOpenTopic={noop} onNew={noop} onSearch={noop} onCollapse={noop} onAbout={noop} onMutation={done}/>
    <main className="main-pane" data-tour="conversation">
      <header className="main-header"><div className="header-title"><button>{work.title}<ChevronDown size={12}/></button><span>{work.project}</span></div><PanelRight size={18}/></header>
      <ChatView work={work} state={state} workspaceVisible={true} sending={false} onSend={done} onStop={noop} onRead={noop} onFork={noop} onOpenConversation={noop} onOpenArtifact={noop} onOpenApps={noop} onOpenApp={noop} onOpenSubagent={noop} onOpenWork={noop} onClearTarget={noop}/>
    </main>
    {<WorkspacePanel state={state} work={work} panel={{kind:"app",appId:previewCase.id}} expanded={false} sidebarCollapsed={false}
      onResize={noop} onExpand={noop} onClose={noop} onPanel={noop} onUpdate={done} onSend={noop} onDemoEvent={done} onTrack={noop} onAction={noop} onOpenWork={noop} onConversation={noop} onDiscuss={noop} onRunWork={noop} onDelegate={done} onContinueSubagent={done} onStopSubagent={done} onToggleTrigger={noop}/>}
  </div>;
}
