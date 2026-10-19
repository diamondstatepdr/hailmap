import { directoryBytes, historyDir, indexSummary } from "../src/lib/history-db";
import { ensureHistoryIndex } from "../src/lib/spc-archive";

await ensureHistoryIndex();
const summary = indexSummary();
const bytes = directoryBytes(historyDir());
console.log(JSON.stringify({ summary, bytes, mb: Math.round((bytes / 1024 / 1024) * 10) / 10 }, null, 2));
