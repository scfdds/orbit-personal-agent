import { OrbitStore, HttpError, id } from './store.ts';
import type { ConversationSection } from '../shared/types.ts';

/** Sidebar organization is independent of conversation ancestry and execution state. */
export class SectionService {
  private store: OrbitStore;
  constructor(store: OrbitStore) { this.store = store; }
  ensure(name: string): ConversationSection {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 160) throw new HttpError(400, '分区名称应为 1–160 个字符');
    const existing = this.store.list('sections').find(s => s.name === trimmed);
    return existing ?? this.store.put('sections', { id: id('section'), name: trimmed, pinned: false, order: this.store.list('sections').length });
  }
  list() {
    const conversations = this.store.list('conversations');
    for (const c of conversations.filter(c => !c.archived)) this.ensure(c.project || '未分区');
    if (!this.store.metadata('sections:migrated')) {
      for (const c of conversations.filter(c => c.pinned && !c.archived)) {
        const s = this.ensure(c.project || '未分区');
        this.store.put('sections', { ...s, pinned: true });
        this.store.updateConversation(c.id,{pinned:false});
      }
      this.store.setMetadata('sections:migrated', true);
    }
    return this.store.list('sections').sort((a,b) => Number(b.pinned)-Number(a.pinned) || a.order-b.order);
  }
  update(sectionId: string, patch: { name?: string; pinned?: boolean }) {
    const section = this.store.require('sections', sectionId);
    const name = patch.name?.trim() ?? section.name;
    if (!name || name.length > 160) throw new HttpError(400, '分区名称应为 1–160 个字符');
    if (this.store.list('sections').some(s => s.id !== sectionId && s.name === name)) throw new HttpError(409, '已有同名分区');
    return this.store.transaction(() => {
      const project = this.store.list('projects').find(project => project.name === section.name);
      if (project) this.store.put('projects', { ...project, name, pinned: patch.pinned ?? project.pinned, updatedAt: new Date().toISOString() });
      if (name !== section.name) for (const c of this.store.list('conversations').filter(c => c.project === section.name)) this.store.updateConversation(c.id, project ? { projectId: project.id } : { project: name });
      return this.store.put('sections', { ...section, ...patch, name });
    });
  }
  reorder(sectionId: string, beforeId?: string) {
    const sections = this.list();
    const section = this.store.require('sections', sectionId);
    if (sectionId === beforeId) return;
    if (beforeId) this.store.require('sections', beforeId);
    const ordered = sections.filter(s => s.id !== sectionId);
    const at = beforeId ? ordered.findIndex(s => s.id === beforeId) : ordered.length;
    ordered.splice(at, 0, section);
    this.store.transaction(() => ordered.forEach((s, order) => {
      this.store.put('sections', { ...s, order });
      const project = this.store.list('projects').find(project => project.name === s.name);
      if (project) this.store.put('projects', { ...project, order });
    }));
  }
  move(conversationId: string, sectionId: string, beforeId?: string) {
    const c = this.store.require('conversations', conversationId);
    const s = this.store.require('sections', sectionId);
    if (beforeId === conversationId) return c;
    if (beforeId && this.store.require('conversations', beforeId).project !== s.name) throw new HttpError(400, '目标对话不在该分区');
    const items = this.store.list('conversations').filter(item => item.project === s.name && item.id !== c.id).sort((a,b) => (a.order ?? Date.parse(a.createdAt))-(b.order ?? Date.parse(b.createdAt)));
    const at = beforeId ? items.findIndex(item => item.id === beforeId) : items.length;
    items.splice(at, 0, { ...c, project: s.name });
    this.store.transaction(() => items.forEach((item, order) => this.store.put('conversations', { ...item, order, pinned: false })));
    return this.store.require('conversations', c.id);
  }
  remove(sectionId: string) {
    const s = this.store.require('sections', sectionId);
    const items = this.store.list('conversations').filter(c => c.project === s.name);
    if (s.name === '未分区' && items.length) throw new HttpError(409, '请先移走未分区中的对话');
    this.store.transaction(() => {
      if (items.length) {
        const fallback = this.ensure('未分区');
        for (const c of items) this.move(c.id, fallback.id);
      }
      this.store.db.prepare('DELETE FROM sections WHERE id=?').run(sectionId);
      const project = this.store.list('projects').find(project => project.name === s.name);
      if (project) {
        this.store.db.prepare('DELETE FROM projects WHERE id=?').run(project.id);
        this.store.db.prepare('DELETE FROM sharedMemories WHERE id=?').run(`project:${project.id}`);
      }
    });
  }
}
