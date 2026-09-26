"use client";

// Live Perpl market state over the public market-data WebSocket, with capped exponential reconnect.
// One subscription frame per connection keeps us far below the 10 requests/min limit.
import { useEffect, useRef, useState } from "react";
import {
  type MarketState,
  PERPL_TESTNET,
  PERPL_TESTNET_WS,
  heartbeatGap,
  parseMarketDataMessage,
  subscriptionFrame,
} from "@omniagent/core";

export type ConnectionStatus = "connecting" | "open" | "closed";

export function useMarketData() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [states, setStates] = useState<Record<string, MarketState>>({});
  const [headBlock, setHeadBlock] = useState<number>();
  const [lastUpdate, setLastUpdate] = useState<number>();
  const [gaps, setGaps] = useState(0);
  const [subErrors, setSubErrors] = useState<string[]>([]);
  const lastSn = useRef<number | undefined>(undefined);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_PERPL_WS_URL || PERPL_TESTNET_WS;
    let ws: WebSocket | undefined;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry = 0;
        lastSn.current = undefined;
        setStatus("open");
        ws?.send(JSON.stringify(subscriptionFrame(PERPL_TESTNET.chainId)));
      };
      ws.onmessage = ev => {
        const msg = parseMarketDataMessage(String(ev.data));
        if (msg.kind === "market-state") {
          setStates(prev => ({ ...prev, ...msg.states }));
          setLastUpdate(Date.now());
        } else if (msg.kind === "heartbeat") {
          if (heartbeatGap(lastSn.current, msg.sn)) setGaps(g => g + 1);
          lastSn.current = msg.sn;
          setHeadBlock(msg.head);
        } else if (msg.kind === "subscription") {
          setSubErrors(msg.subs.filter(s => s.code !== 0).map(s => `${s.stream}: ${s.code} ${s.error ?? ""}`));
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { status, states, headBlock, lastUpdate, gaps, subErrors };
}
