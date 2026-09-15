const hourFormatters = new Map();

function localHour(now, timeZone) {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    });
    hourFormatters.set(timeZone, formatter);
  }

  const hour = formatter.formatToParts(now).find(part => part.type === "hour");
  return Number(hour.value);
}

export function collectorWindow(
  now,
  { timeZone = "America/Sao_Paulo", startHour = 7, endHour = 23 } = {},
) {
  const hour = localHour(now, timeZone);
  return hour >= startHour && hour < endHour;
}

export function nextCollectorDelay(now, intervalMs = 1_200_000, window = {}) {
  if (collectorWindow(now, window)) return intervalMs;

  const timestamp = now.getTime();
  let candidate = timestamp - (timestamp % 60_000) + 60_000;
  const searchLimit = candidate + (48 * 60 * 60 * 1_000);

  while (candidate <= searchLimit) {
    if (collectorWindow(new Date(candidate), window)) return candidate - timestamp;
    candidate += 60_000;
  }

  throw new RangeError("collector window does not open within 48 hours");
}
