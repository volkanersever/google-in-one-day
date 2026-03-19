const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? 1;

function fmt(level, component, msg, data) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${component}] ${msg}`;
  if (data !== undefined) {
    return `${base} ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(component) {
  return {
    debug(msg, data) {
      if (currentLevel <= 0) console.debug(fmt('debug', component, msg, data));
    },
    info(msg, data) {
      if (currentLevel <= 1) console.log(fmt('info', component, msg, data));
    },
    warn(msg, data) {
      if (currentLevel <= 2) console.warn(fmt('warn', component, msg, data));
    },
    error(msg, data) {
      if (currentLevel <= 3) console.error(fmt('error', component, msg, data));
    },
  };
}
