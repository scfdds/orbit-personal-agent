import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { WorkspaceMode } from "../shared/workspace-mode.ts";
import { OrbitRuntime } from "./runtime.ts";
import { HttpError, OrbitStore } from "./store.ts";
import { seedWorkspaceDemo } from "./showcases/workspace-demo.ts";

/** A demo is an ordinary workspace backed by its own database and files. */
export class WorkspaceModes {
  private demoRuntime?: OrbitRuntime;
  private closePromise?: Promise<void>;
  private current: WorkspaceMode;
  readonly real: OrbitRuntime;
  switched = false;
  constructor(real: OrbitRuntime) {
    this.real = real;
    this.current = { demo: real.store.metadata<boolean>("workspace-demo-active") === true, revision: randomUUID() };
    if (this.current.demo) this.ensureDemo();
    this.real.organizer.setSuspended(this.current.demo);
  }
  get state(): WorkspaceMode { return { ...this.current }; }
  get runtime() { return this.current.demo ? this.ensureDemo() : this.real; }
  private ensureDemo() {
    if (!this.demoRuntime) {
      const dataDir = resolve(this.real.dataDir, "demo-workspace");
      const runtime = new OrbitRuntime(new OrbitStore(resolve(dataDir, "orbit.sqlite")), this.real.apps, dataDir, { demoMode: true });
      try {
        seedWorkspaceDemo(runtime);
        runtime.initialize({ seed: false });
        this.demoRuntime = runtime;
      } catch (error) {
        void runtime.close().finally(() => runtime.store.close());
        throw error;
      }
    }
    return this.demoRuntime;
  }
  assertRevision(revision: unknown) {
    if (revision !== this.current.revision) throw new HttpError(409, "工作区已切换，请重新加载后继续");
  }
  switch(demo: unknown, revision: unknown) {
    this.assertRevision(revision);
    if (typeof demo !== "boolean") throw new HttpError(400, "demo 必须是布尔值");
    if (demo === this.current.demo) return this.state;
    if (demo) this.ensureDemo();
    this.real.store.setMetadata("workspace-demo-active", demo);
    this.real.organizer.setSuspended(demo);
    this.demoRuntime?.organizer.setSuspended(!demo);
    this.current = { demo, revision: randomUUID() };
    this.switched = true;
    return this.state;
  }
  close() {
    return this.closePromise ??= (async () => {
      if (this.demoRuntime) {
        await this.demoRuntime.close();
        this.demoRuntime.store.close();
      }
    })();
  }
}
