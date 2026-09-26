import { loadConfig } from "./config";
import { createWorker } from "./server";

const cfg = loadConfig();
createWorker(cfg).listen(cfg.port, () => {
  console.log(
    `omniagent worker on :${cfg.port} — mode=${cfg.executionEnabled ? "LIVE" : "dry-run"} slippage=${cfg.slippageBps}bps`,
  );
});
