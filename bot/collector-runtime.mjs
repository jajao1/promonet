import {setTimeout as defaultDelay} from "node:timers/promises";
import {collectorWindow, nextCollectorDelay} from "./collector-schedule.mjs";

async function wait(delay, milliseconds, signal) {
  try {
    await delay(milliseconds, undefined, {signal});
    return true;
  } catch (error) {
    if (signal?.aborted && error?.name === "AbortError") return false;
    throw error;
  }
}

export async function runCollectorLoop({
  enabled,
  collect,
  delay = defaultDelay,
  log = value => console.error(value),
  now = () => new Date(),
  intervalMs = 1_200_000,
  window = {timeZone: "America/Sao_Paulo", startHour: 7, endHour: 23},
  iterations = Infinity,
  signal,
}) {
  if (!enabled || signal?.aborted) return;

  for (let i = 0; i < iterations; i++) {
    if (signal?.aborted) return;
    const iterationTime = now();
    if (!collectorWindow(iterationTime, window)) {
      if (!await wait(delay, nextCollectorDelay(iterationTime, intervalMs, window), signal)) return;
      continue;
    }

    try {
      await collect();
    } catch (error) {
      if (signal?.aborted && error?.name === "AbortError") return;
      log('{"event":"collector_unavailable"}');
      if (!await wait(delay, 30_000, signal)) return;
      continue;
    }

    if (!await wait(delay, nextCollectorDelay(now(), intervalMs, window), signal)) return;
  }
}
