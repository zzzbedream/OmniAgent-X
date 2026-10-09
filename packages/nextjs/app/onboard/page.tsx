"use client";

// Phase 1 onboarding: passkey (Mera) → Perpl DelegatedAccount with the worker as operator → deposit → withdraw.
// Every write is signed by the passkey-derived owner key; the operator can never withdraw.
import { useCallback, useEffect, useState } from "react";
import {
  AGORA_AUSD_FAUCET_TESTNET,
  APPROVAL_DOMAIN,
  type AllowlistChange,
  CONSENT_REQUEST_TYPES,
  FUND_REQUEST_TYPES,
  PERPL_TESTNET,
  PERPL_TESTNET_MIN_DEPOSIT_AUSD,
  PERPL_TESTNET_MIN_OPEN_AUSD,
  ausdFaucetAbi,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  erc20Abi,
  exchangeAbi,
  readAllowlistDrift,
  readCollateral,
  readDelegatedAccount,
} from "@omniagent/core";
import type { NextPage } from "next";
import { type Address, formatEther, formatUnits, isAddress, parseEther, parseEventLogs, parseUnits } from "viem";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { EXPLORER_TX, friendlyTxError, shortHex } from "~~/components/omni/format";
import { loadDelegatedAccount, saveDelegatedAccount, worker } from "~~/lib/omni/worker";
import { publicClient, useMera } from "~~/services/mera/MeraProvider";

type Status = {
  monBalance: bigint;
  collateral: { token: Address; decimals: number; symbol: string };
  ownerCollateral: bigint;
  account?: Awaited<ReturnType<typeof readDelegatedAccount>> & {
    address: Address;
    heldCollateral: bigint;
    allowlistDrift: AllowlistChange[];
  };
  operator?: Address;
  workerMode?: string;
};

/** Below this the passkey address cannot pay for onboarding; the gas station tops it up (0.5 MON). */
const LOW_GAS_WEI = parseEther("0.05");

const Onboard: NextPage = () => {
  const { account, walletClient, busy, error, create, signIn, confirm, end } = useMera();
  const [userName, setUserName] = useState("");
  const [status, setStatus] = useState<Status>();
  const [delegated, setDelegated] = useState<Address>();
  const [amount, setAmount] = useState(String(PERPL_TESTNET_MIN_OPEN_AUSD));
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [fundState, setFundState] = useState<"idle" | "running" | "done">("idle");

  const push = useCallback(
    (line: string) => setLog(prev => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 30)),
    [],
  );

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const [monBalance, collateral, health] = await Promise.all([
        publicClient.getBalance({ address: account.address }),
        readCollateral(publicClient),
        worker.health().catch(() => undefined),
      ]);
      const ownerCollateral = await publicClient.readContract({
        address: collateral.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      let acc: Status["account"];
      if (delegated) {
        const [info, heldCollateral, allowlistDrift] = await Promise.all([
          readDelegatedAccount(publicClient, delegated, health?.operator),
          publicClient.readContract({
            address: collateral.token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [delegated],
          }),
          readAllowlistDrift(publicClient, delegated),
        ]);
        acc = { ...info, address: delegated, heldCollateral, allowlistDrift };
      }
      setStatus({
        monBalance,
        collateral,
        ownerCollateral,
        account: acc,
        operator: health?.operator,
        workerMode: health ? (health.executionEnabled ? "LIVE" : "dry-run") : "sin conexión",
      });
    } catch (e) {
      push(`error leyendo estado: ${(e as Error).message}`);
    }
  }, [account, delegated, push]);

  useEffect(() => {
    // A different passkey is a different user: forget the previous one's balances and funding attempt.
    setStatus(undefined);
    setFundState("idle");
    if (account) setDelegated(loadDelegatedAccount(account.address));
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A brand-new passkey address has no MON, so it cannot send the first onboarding transaction (the Perpl
  // contracts require the owner as sender). Ask the worker's testnet gas station once, as soon as it is seen.
  const requestTestFunds = useCallback(async () => {
    if (!account || !walletClient) return;
    setFundState("running");
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: FUND_REQUEST_TYPES,
        primaryType: "FundRequest",
        message: { owner: account.address, deadline },
      });
      const r = await worker.fund({ owner: account.address, deadline: deadline.toString(), signature });
      if (r.status === "already-funded") push("fondos de prueba: esta dirección ya los recibió antes");
      if (r.mon?.status === "sent") push(`gas de prueba recibido ${r.mon.txHash}`);
      if (r.collateral?.status === "sent") push(`AUSD de prueba recibidos ${r.collateral.txHash}`);
      if (r.collateral?.status === "failed") push(`AUSD de prueba falló (usa el faucet abajo): ${r.collateral.error}`);
    } catch (e) {
      push(`fondos de prueba falló: ${friendlyTxError(e)}`);
    } finally {
      setFundState("done");
      void refresh();
    }
  }, [account, walletClient, refresh, push]);

  useEffect(() => {
    if (fundState === "idle" && status && status.monBalance < LOW_GAS_WEI) void requestTestFunds();
  }, [fundState, status, requestTestFunds]);

  const tx = async (label: string, fn: () => Promise<`0x${string}`>) => {
    setPending(true);
    try {
      const hash = await fn();
      push(`${label}: enviada ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`revertida (${hash})`);
      push(`${label}: confirmada`);
      return receipt;
    } catch (e) {
      push(`${label} falló: ${friendlyTxError(e)}`);
      return undefined;
    } finally {
      setPending(false);
      void refresh();
    }
  };

  /** One fingerprint / Face ID per user action, even when the action sends several transactions. */
  const confirmed = async (label: string) => {
    try {
      await confirm();
      return true;
    } catch (e) {
      push(`${label}: ${friendlyTxError(e)}`);
      return false;
    }
  };

  const createTradingAccount = async () => {
    if (!account || !walletClient) return;
    if (!(await confirmed("crear cuenta de trading"))) return;
    let consent;
    try {
      // Prove control of the owner address before the worker signs an operator consent for it.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: CONSENT_REQUEST_TYPES,
        primaryType: "ConsentRequest",
        message: { owner: account.address, deadline },
      });
      consent = await worker.consent({ owner: account.address, deadline: deadline.toString(), signature });
    } catch (e) {
      push(`worker no disponible: ${friendlyTxError(e)}`);
      return;
    }
    const receipt = await tx("crear cuenta delegada", () =>
      walletClient.writeContract({
        address: PERPL_TESTNET.factory,
        abi: delegatedAccountFactoryAbi,
        functionName: "create",
        args: [consent.operator, BigInt(consent.deadline), consent.signature],
      }),
    );
    if (!receipt) return;
    const [created] = parseEventLogs({
      abi: delegatedAccountFactoryAbi,
      logs: receipt.logs,
      eventName: "DelegatedAccountCreated",
    });
    if (!created) return push("no se encontró el evento DelegatedAccountCreated");
    saveDelegatedAccount(account.address, created.args.proxy);
    setDelegated(created.args.proxy);
    push(`cuenta delegada: ${created.args.proxy} (operador ${created.args.operator})`);
  };

  // One owner transaction per selector, same changes as Perpl's SyncOperatorAllowlistScript.
  const repairAllowlist = async () => {
    if (!walletClient || !status?.account) return;
    if (!(await confirmed("reparar permisos"))) return;
    const acc = status.account;
    for (const change of acc.allowlistDrift) {
      const ok = await tx(`${change.allowed ? "permitir" : "revocar"} ${change.name}`, () =>
        walletClient.writeContract({
          address: acc.address,
          abi: delegatedAccountAbi,
          functionName: "setOperatorAllowlist",
          args: [change.selector, change.allowed],
        }),
      );
      if (!ok) return;
    }
  };

  const deposit = async () => {
    if (!walletClient || !status?.account) return;
    if (!(await confirmed("depositar"))) return;
    const amountCNS = parseUnits(amount, status.collateral.decimals);
    const acc = status.account;
    // Tokens must sit in the DelegatedAccount before createAccount/depositCollateral pull them.
    const missing = amountCNS > acc.heldCollateral ? amountCNS - acc.heldCollateral : 0n;
    if (missing > 0n) {
      const ok = await tx("transferir colateral", () =>
        walletClient.writeContract({
          address: status.collateral.token,
          abi: erc20Abi,
          functionName: "transfer",
          args: [acc.address, missing],
        }),
      );
      if (!ok) return;
    }
    if (acc.accountId === 0n) {
      await tx("crear cuenta en el exchange", () =>
        walletClient.writeContract({
          address: acc.address,
          abi: delegatedAccountAbi,
          functionName: "createAccount",
          args: [amountCNS],
        }),
      );
    } else {
      // The owner may call any Exchange function through the DelegatedAccount fallback.
      await tx("depositar colateral", () =>
        walletClient.writeContract({
          address: acc.address,
          abi: exchangeAbi,
          functionName: "depositCollateral",
          args: [amountCNS],
        }),
      );
    }
  };

  // Testnet only: Agora's faucet sends AUSD to the passkey address (the balance below shows whether it arrived).
  const requestAusd = async () => {
    if (!walletClient || !account) return;
    await tx("pedir AUSD de prueba", () =>
      walletClient.writeContract({
        address: AGORA_AUSD_FAUCET_TESTNET,
        abi: ausdFaucetAbi,
        functionName: "requestFunds",
        args: [account.address],
      }),
    );
  };

  const withdraw = async () => {
    if (!walletClient || !status?.account) return;
    const acc = status.account;
    // Withdrawing leaves the agent nothing to trade with, so ask once.
    if (!window.confirm(`¿Retirar ${amount} ${status.collateral.symbol} del exchange a tu wallet?`)) return;
    if (!(await confirmed("retirar"))) return;
    await tx("retirar colateral", () =>
      walletClient.writeContract({
        address: acc.address,
        abi: delegatedAccountAbi,
        functionName: "withdrawCollateral",
        args: [parseUnits(amount, status.collateral.decimals)],
      }),
    );
  };

  const fmt = (v: bigint | undefined) =>
    v === undefined || !status ? "—" : `${formatUnits(v, status.collateral.decimals)} ${status.collateral.symbol}`;

  const isAllowlistOk = !!status?.account && status.account.allowlistDrift.length === 0;
  const isAccountOpen = !!status?.account && status.account.accountId > 0n;

  return (
    <div className="mx-auto flex w-full max-w-[560px] grow flex-col gap-5 px-4 pt-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold tracking-tight">Cuenta</h1>
        <p className="text-sm text-ash">
          Tu passkey es la llave. El agente opera tu cuenta, pero solo tú puedes retirar.
        </p>
      </header>

      <section className="panel flex flex-col gap-3 p-4">
        <StepHeader n={1} title="Passkey" detail="Mera · sin frase semilla" isDone={!!account} />
        {!account ? (
          <>
            <input
              className="input input-bordered w-full bg-raised"
              placeholder="Nombre para el passkey (p. ej. tu email)"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              aria-label="Nombre del passkey"
            />
            <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
              <button className="btn btn-primary" disabled={busy || !userName} onClick={() => create(userName)}>
                Crear passkey
              </button>
              <button className="btn btn-outline border-line" disabled={busy} onClick={signIn}>
                Ya tengo passkey
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2">
            <span className="num text-sm break-all">{account.address}</span>
            <button className="btn btn-ghost btn-sm text-ash" onClick={end}>
              Salir
            </button>
          </div>
        )}
        {error && <p className="text-sm text-short">{error}</p>}
        {account && status && (
          <p className="num text-xs text-smoke">
            Gas:{" "}
            <span className={status.monBalance >= LOW_GAS_WEI ? "text-ash" : "text-short"}>
              {formatEther(status.monBalance)} MON
            </span>
          </p>
        )}
        {fundState === "running" && (
          <p className="flex items-center gap-2 rounded-md border border-violet/40 bg-violet-wash px-3 py-2 text-sm">
            <span className="loading loading-spinner loading-xs text-violet" aria-hidden />
            Preparando tu cuenta: enviando gas y AUSD de prueba…
          </p>
        )}
        {account && status && fundState === "done" && status.monBalance < LOW_GAS_WEI && (
          <button className="btn btn-outline btn-sm self-start border-line" onClick={requestTestFunds}>
            Reintentar gas de prueba
          </button>
        )}
      </section>

      {account && (
        <section className="panel flex flex-col gap-3 p-4">
          <StepHeader
            n={2}
            title="Cuenta de trading"
            detail="Perpl DelegatedAccount"
            isDone={!!delegated && !!status?.account?.isOperator}
          />
          <p className="text-sm text-ash">
            El agente <span className="num text-bone">{status?.operator ? shortHex(status.operator) : "?"}</span> puede
            operar pero no retirar.{" "}
            {status?.workerMode && (
              <span className={status.workerMode === "LIVE" ? "chip-live" : "chip-sim"}>
                {status.workerMode === "LIVE"
                  ? "En vivo"
                  : status.workerMode === "dry-run"
                    ? "Simulación"
                    : status.workerMode}
              </span>
            )}
          </p>
          {!delegated ? (
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary"
                disabled={pending || fundState === "running"}
                onClick={createTradingAccount}
              >
                Crear cuenta de trading
              </button>
              <input
                className="input input-bordered input-sm w-full bg-raised"
                placeholder="…o pega la dirección de una cuenta existente"
                onChange={e => {
                  if (isAddress(e.target.value)) {
                    saveDelegatedAccount(account.address, e.target.value);
                    setDelegated(e.target.value);
                  }
                }}
                aria-label="Dirección de cuenta delegada existente"
              />
            </div>
          ) : (
            <dl className="rounded-md border border-line bg-raised px-3">
              <KeyValue label="Cuenta delegada">
                <span className="num">{shortHex(delegated)}</span>
              </KeyValue>
              <KeyValue label="Owner correcto">
                <Check value={status?.account ? status.account.owner === account.address : undefined} />
              </KeyValue>
              <KeyValue label="Operador activo">
                <Check value={status?.account?.isOperator} />
              </KeyValue>
              <KeyValue label="Account ID (exchange)">
                <span className="num">{status?.account?.accountId.toString() ?? "—"}</span>
              </KeyValue>
            </dl>
          )}
        </section>
      )}

      {account && delegated && status?.account && status.account.allowlistDrift.length > 0 && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-box)] border border-amber/40 bg-amber/5 p-4">
          <h2 className="font-semibold text-amber">Permisos del agente desactualizados</h2>
          <p className="text-sm text-ash">
            La Factory de Perpl en testnet crea cuentas con una allowlist antigua, y el agente aún no puede llamar a{" "}
            <code className="num text-bone">execOrder</code>. Esto aplica los mismos cambios que el script oficial de
            Perpl: {status.account.allowlistDrift.length} transacciones firmadas por ti.
          </p>
          <ul className="flex flex-col gap-1 text-xs">
            {status.account.allowlistDrift.map(c => (
              <li key={c.selector} className="flex items-center justify-between gap-2">
                <span className={c.allowed ? "text-long" : "text-short"}>
                  {c.allowed ? "permitir" : "revocar"} {c.name}
                </span>
                <span className="num text-smoke">{c.selector}</span>
              </li>
            ))}
          </ul>
          <button className="btn btn-warning" disabled={pending} onClick={repairAllowlist}>
            Reparar permisos
          </button>
        </section>
      )}

      {account && delegated && status?.account && (
        <section className="panel flex flex-col gap-4 p-4">
          <StepHeader
            n={3}
            title="Colateral"
            detail={`${status.collateral.symbol} · leído on-chain`}
            isDone={isAccountOpen && isAllowlistOk}
          />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="En el exchange" value={fmt(status.account.balanceCNS)} isHero />
            <Stat label="En tu wallet" value={fmt(status.ownerCollateral)} />
            <Stat label="Bloqueado" value={fmt(status.account.lockedBalanceCNS)} />
            <Stat
              label="Mínimos"
              value={`abrir ${PERPL_TESTNET_MIN_OPEN_AUSD} · luego ${PERPL_TESTNET_MIN_DEPOSIT_AUSD}`}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">Monto</span>
            <div className="flex items-center rounded-[var(--radius-field)] border border-line bg-raised focus-within:border-violet">
              <input
                className="num w-full bg-transparent px-3 py-2.5 text-[15px] outline-none"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                aria-label="Monto"
              />
              <span className="num pr-3 text-sm text-smoke">{status.collateral.symbol}</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={deposit}>
              {status.account.accountId === 0n ? "Depositar y abrir" : "Depositar"}
            </button>
            <button
              className="btn btn-outline border-short/50 text-short hover:border-short hover:bg-short/10"
              disabled={pending || status.account.accountId === 0n}
              onClick={withdraw}
            >
              Retirar
            </button>
          </div>
          <button className="btn btn-ghost btn-sm self-start text-ash" disabled={pending} onClick={requestAusd}>
            Pedir AUSD de prueba (faucet de Agora)
          </button>
        </section>
      )}

      {log.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4" aria-label="Actividad">
          <h2 className="label-caps">Actividad</h2>
          <ol className="flex flex-col gap-1.5">
            {log.map((line, i) => (
              <LogLine key={`${i}-${line}`} line={line} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
};

const StepHeader = ({ n, title, detail, isDone }: { n: number; title: string; detail: string; isDone: boolean }) => (
  <header className="flex items-center gap-3">
    <span
      className={`num flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
        isDone ? "border-violet bg-violet text-void" : "border-line-strong bg-violet-wash text-violet"
      }`}
    >
      {isDone ? "✓" : n}
    </span>
    <span className="flex flex-col">
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-smoke">{detail}</span>
    </span>
  </header>
);

const KeyValue = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
    <dt className="text-ash">{label}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

const Check = ({ value }: { value: boolean | undefined }) =>
  value === undefined ? (
    <span className="text-smoke">—</span>
  ) : value ? (
    <CheckCircleIcon className="inline h-5 w-5 text-long" aria-label="sí" />
  ) : (
    <XCircleIcon className="inline h-5 w-5 text-short" aria-label="no" />
  );

const Stat = ({ label, value, isHero = false }: { label: string; value: string; isHero?: boolean }) => (
  <div className="flex flex-col gap-1 rounded-md border border-line bg-raised p-3">
    <span className="label-caps">{label}</span>
    <span className={`num ${isHero ? "text-lg font-semibold text-bone" : "text-sm text-ash"}`}>{value}</span>
  </div>
);

/** Activity line: state dot from the verb, and any tx hash linked to the explorer. */
const LogLine = ({ line }: { line: string }) => {
  const hash = line.match(/0x[0-9a-fA-F]{64}/)?.[0];
  const isFail = / falló|error|no disponible/.test(line);
  const isDone = /confirmada|cuenta delegada:/.test(line);
  const text = hash ? line.replace(hash, "") : line;
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isFail ? "bg-short" : isDone ? "bg-long" : "bg-amber"}`}
        aria-hidden
      />
      <span className={`break-words ${isFail ? "text-short" : "text-ash"}`}>
        {text}
        {hash && (
          <a className="link num ml-1" href={`${EXPLORER_TX}${hash}`} target="_blank" rel="noopener noreferrer">
            {shortHex(hash, 10, 6)}
          </a>
        )}
      </span>
    </li>
  );
};

export default Onboard;
