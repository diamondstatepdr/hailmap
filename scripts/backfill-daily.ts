import { ensureDaily, listDates } from "../src/lib/spc-archive";

const start = process.env.HISTORY_DAILY_START ?? "2025-12-29";
const end = process.env.HISTORY_DAILY_END ?? new Date().toISOString().slice(0, 10);
const dates = listDates(start, end);
let done = 0;
const failed: string[] = [];
for (const date of dates) {
  try {
    await ensureDaily(date);
  } catch (error) {
    failed.push(date);
    console.error(date, error instanceof Error ? error.message : error);
  }
  done += 1;
  if (done === 1 || done % 25 === 0 || done === dates.length) {
    console.log(`${done}/${dates.length} ${date}`);
  }
}
for (const date of failed) {
  try {
    await ensureDaily(date);
    console.log("retried", date);
  } catch (error) {
    console.error("still failed", date, error instanceof Error ? error.message : error);
  }
}
console.log("daily backfill complete", { start, end, days: dates.length });
