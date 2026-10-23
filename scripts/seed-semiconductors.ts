import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { DatabaseSync, backup } from "node:sqlite";
import { OrbitStore } from "../src/server/store.ts";
import { seedSemiconductorShowcase } from "../src/server/showcases/semiconductors.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const database = resolve(root, ".agent-data/orbit/orbit.sqlite");
if (existsSync(database)) {
  const directory = resolve(root, ".agent-data/backups");
  mkdirSync(directory, { recursive: true });
  const connection = new DatabaseSync(database);
  try {
    await backup(
      connection,
      resolve(directory, `before-semiconductors-${Date.now()}.sqlite`),
    );
  } finally {
    connection.close();
  }
}
const store = new OrbitStore(database);
try {
  const result = seedSemiconductorShowcase(store);
  console.log(
    result.inserted
      ? "已添加「看懂美光与存储周期」：4 段对话、42 条消息、24 条记忆、3 份资料。刷新页面即可查看。"
      : "案例已存在，保留你的修改，不重复导入。",
  );
} finally {
  store.close();
}
