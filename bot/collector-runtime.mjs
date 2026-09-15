import {setTimeout as defaultDelay} from "node:timers/promises";
import {collectorWindow, nextCollectorDelay} from "./collector-schedule.mjs";

export async function runCollectorLoop({
  enabled,
  collect,
  delay = defaultDelay,
  log = value => console.error(value),
  now = () => new Date(),
  intervalMs = 1_200_000,
  window = {timeZone: "America/Sao_Paulo", startHour: 7, endHour: 23},
  iterations = Infinity,
}) {
  if (!enabled) return;

  for (let i = 0; i < iterations; i++) {
    const iterationTime = now();
    if (!collectorWindow(iterationTime, window)) {
      await delay(nextCollectorDelay(iterationTime, intervalMs, window));
      continue;
    }

    try {
      await collect();
    } catch {
      log('{"event":"collector_unavailable"}');
      await delay(30_000);
      continue;
    }

    await delay(nextCollectorDelay(now(), intervalMs, window));
  }
}
