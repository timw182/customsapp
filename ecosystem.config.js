const { readFileSync } = require("fs");
const { resolve } = require("path");

// Load .env file into env object so PM2 sets them as real environment variables
// (node --env-file doesn't override inherited env vars like empty ANTHROPIC_API_KEY)
function loadDotenv(filePath) {
  const vars = {};
  try {
    const content = readFileSync(resolve(__dirname, filePath), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      vars[key] = val;
    }
  } catch {}
  return vars;
}

module.exports = {
  apps: [{
    name: "customs-calculator",
    script: ".next/standalone/server.js",
    cwd: "/var/www/customs",
    env: {
      NODE_ENV: "production",
      ...loadDotenv(".env"),
    },
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
};
