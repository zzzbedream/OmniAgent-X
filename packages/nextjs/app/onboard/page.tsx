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
import { resolveDelegatedAccount } from "~~/lib/omni/account";
import { saveDelegatedAccount, worker } from "~~/lib/omni/worker";
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
  /** Progress of the agent-permission setup that follows account creation. */
  const [setup, setSetup] = useState<{ done: number; total: number }>();

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
        workerMode: health ? (health.executionEnabled ? "LIVE" : "dry-run") : "offline",
      });
    } catch (e) {
      push(`could not read state: ${(e as Error).message}`);
    }
  }, [account, delegated, push]);

  useEffect(() => {
    // A different passkey is a different user: forget the previous one's balances and funding attempt.
    setStatus(undefined);
    setFundState("idle");
    setDelegated(undefined);
    if (!account) return;
    let cancelled = false;
    void resolveDelegatedAccount(account.address).then(r => {
      if (cancelled) return;
      setDelegated(r?.address);
      // Another browser (or cleared site data): the account was found on-chain instead of offering a duplicate.
      if (r?.source === "chain") push(`trading account recovered on-chain: ${r.address}`);
    });
    return () => {
      cancelled = true;
    };
  }, [account, push]);

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
      if (r.status === "already-funded") push("test funds: this address already received them");
      if (r.mon?.status === "sent") push(`test gas received ${r.mon.txHash}`);
      if (r.collateral?.status === "sent") push(`test AUSD received ${r.collateral.txHash}`);
      if (r.collateral?.status === "failed") push(`test AUSD failed (use the faucet below): ${r.collateral.error}`);
    } catch (e) {
      push(`test funds failed: ${friendlyTxError(e)}`);
    } finally {
      setFundState("done");
      void refresh();
    }
  }, [account, walletClient, refresh, push]);

  useEffect(() => {
    if (fundState === "idle" && status && status.monBalance < LOW_GAS_WEI) void requestTestFunds();
  }, [fundState, status, requestTestFunds]);

  /** `quiet` logs only failures and skips the refresh, for steps that report their own progress. */
  const tx = async (label: string, fn: () => Promise<`0x${string}`>, { quiet = false } = {}) => {
    setPending(true);
    try {
      const hash = await fn();
      if (!quiet) push(`${label}: sent ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`reverted (${hash})`);
      if (!quiet) push(`${label}: confirmed`);
      return receipt;
    } catch (e) {
      push(`${label} failed: ${friendlyTxError(e)}`);
      return undefined;
    } finally {
      setPending(false);
      if (!quiet) void refresh();
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
    if (!(await confirmed("create trading account"))) return;
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
      push(`worker unavailable: ${friendlyTxError(e)}`);
      return;
    }
    const receipt = await tx("create delegated account", () =>
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
    if (!created) return push("DelegatedAccountCreated event not found");
    saveDelegatedAccount(account.address, created.args.proxy);
    setDelegated(created.args.proxy);
    push(`delegated account: ${created.args.proxy} (operator ${created.args.operator})`);
    // Same fingerprint: a new account still needs its agent permissions, so the setup continues on its own.
    await setUpAgentPermissions(created.args.proxy);
  };

  // Perpl's testnet factory creates accounts with an old operator allowlist. One owner transaction per selector
  // applies the same changes as Perpl's SyncOperatorAllowlistScript, so the agent can call execOrder.
  const setUpAgentPermissions = async (proxy: Address) => {
    if (!walletClient) return;
    const changes = await readAllowlistDrift(publicClient, proxy).catch(() => undefined);
    if (!changes) return push("agent permissions failed: could not read the allowlist");
    if (changes.length === 0) return;
    setSetup({ done: 0, total: changes.length });
    try {
      for (const [i, change] of changes.entries()) {
        const ok = await tx(
          `agent permission ${change.name}`,
          () =>
            walletClient.writeContract({
              address: proxy,
              abi: delegatedAccountAbi,
              functionName: "setOperatorAllowlist",
              args: [change.selector, change.allowed],
            }),
          { quiet: true },
        );
        if (!ok) return;
        setSetup({ done: i + 1, total: changes.length });
      }
      push(`agent permissions: confirmed (${changes.length} updates)`);
    } finally {
      setSetup(undefined);
      void refresh();
    }
  };

  // Accounts created elsewhere, or a setup interrupted midway, finish it from here.
  const finishSetup = async () => {
    if (!status?.account) return;
    if (!(await confirmed("agent permissions"))) return;
    await setUpAgentPermissions(status.account.address);
  };

  const deposit = async () => {
    if (!walletClient || !status?.account) return;
    if (!(await confirmed("deposit"))) return;
    const amountCNS = parseUnits(amount, status.collateral.decimals);
    const acc = status.account;
    // Tokens must sit in the DelegatedAccount before createAccount/depositCollateral pull them.
    const missing = amountCNS > acc.heldCollateral ? amountCNS - acc.heldCollateral : 0n;
    if (missing > status.ownerCollateral) {
      return push(
        `deposit failed: your wallet has ${fmt(status.ownerCollateral)}, ${fmt(missing)} needed. Request test AUSD below.`,
      );
    }
    if (missing > 0n) {
      const ok = await tx("transfer collateral", () =>
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
      await tx("create exchange account", () =>
        walletClient.writeContract({
          address: acc.address,
          abi: delegatedAccountAbi,
          functionName: "createAccount",
          args: [amountCNS],
        }),
      );
    } else {
      // The owner may call any Exchange function through the DelegatedAccount fallback.
      await tx("deposit collateral", () =>
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
  // Its limit is global (one drip per minute for all of testnet), so wait for the window instead of reverting.
  const requestAusd = async () => {
    if (!walletClient || !account) return;
    setPending(true);
    try {
      const [last, every, block] = await Promise.all([
        publicClient.readContract({
          address: AGORA_AUSD_FAUCET_TESTNET,
          abi: ausdFaucetAbi,
          functionName: "lastDripTimestamp",
        }),
        publicClient.readContract({
          address: AGORA_AUSD_FAUCET_TESTNET,
          abi: ausdFaucetAbi,
          functionName: "maxDripFrequency",
        }),
        publicClient.getBlock(),
      ]);
      const wait = Number(last + every - block.timestamp) + 1;
      if (wait > 0) {
        push(`test AUSD: the faucet is shared by all of testnet, waiting ${wait} s for it`);
        await new Promise(r => setTimeout(r, wait * 1000));
      }
    } catch {
      // Reading the window is only an optimization; the request below still reports its own error.
    } finally {
      setPending(false);
    }
    await tx("request test AUSD", () =>
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
    if (!window.confirm(`Withdraw ${amount} ${status.collateral.symbol} from the exchange to your wallet?`)) return;
    if (!(await confirmed("withdraw"))) return;
    await tx("withdraw collateral", () =>
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
        <h1 className="text-[28px] font-bold tracking-tight">Account</h1>
        <p className="text-sm text-ash">
          Your passkey is the key. The agent trades your account, but only you can withdraw.
        </p>
      </header>

      <section className="panel flex flex-col gap-3 p-4">
        <StepHeader n={1} title="Passkey" detail="Mera · no seed phrase" isDone={!!account} />
        {!account ? (
          <>
            <input
              className="input input-bordered w-full bg-raised"
              placeholder="Name for the passkey (e.g. your email)"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              aria-label="Passkey name"
            />
            <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
              <button className="btn btn-primary" disabled={busy || !userName} onClick={() => create(userName)}>
                Create passkey
              </button>
              <button className="btn btn-outline border-line" disabled={busy} onClick={signIn}>
                I have a passkey
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2">
            <span className="num text-sm break-all">{account.address}</span>
            <button className="btn btn-ghost btn-sm text-ash" onClick={end}>
              Sign out
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
            Preparing your account: sending test gas and AUSD…
          </p>
        )}
        {account && status && fundState === "done" && status.monBalance < LOW_GAS_WEI && (
          <button className="btn btn-outline btn-sm self-start border-line" onClick={requestTestFunds}>
            Retry test gas
          </button>
        )}
      </section>

      {account && (
        <section className="panel flex flex-col gap-3 p-4">
          <StepHeader
            n={2}
            title="Trading account"
            detail="Perpl DelegatedAccount"
            isDone={!!delegated && !!status?.account?.isOperator}
          />
          <p className="text-sm text-ash">
            The agent <span className="num text-bone">{status?.operator ? shortHex(status.operator) : "?"}</span> can
            trade but not withdraw.{" "}
            {status?.workerMode && (
              <span className={status.workerMode === "LIVE" ? "chip-live" : "chip-sim"}>
                {status.workerMode === "LIVE"
                  ? "Live"
                  : status.workerMode === "dry-run"
                    ? "Simulation"
                    : status.workerMode}
              </span>
            )}
          </p>
          {!delegated ? (
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary"
                disabled={pending || !!setup || fundState === "running"}
                onClick={createTradingAccount}
              >
                Create trading account
              </button>
              <input
                className="input input-bordered input-sm w-full bg-raised"
                placeholder="…or paste an existing account address"
                onChange={e => {
                  if (isAddress(e.target.value)) {
                    saveDelegatedAccount(account.address, e.target.value);
                    setDelegated(e.target.value);
                  }
                }}
                aria-label="Existing delegated account address"
              />
            </div>
          ) : (
            <dl className="rounded-md border border-line bg-raised px-3">
              <KeyValue label="Delegated account">
                <span className="num">{shortHex(delegated)}</span>
              </KeyValue>
              <KeyValue label="Correct owner">
                <Check value={status?.account ? status.account.owner === account.address : undefined} />
              </KeyValue>
              <KeyValue label="Operator active">
                <Check value={status?.account?.isOperator} />
              </KeyValue>
              <KeyValue label="Account ID (exchange)">
                <span className="num">{status?.account?.accountId.toString() ?? "—"}</span>
              </KeyValue>
            </dl>
          )}
        </section>
      )}

      {setup && (
        <section
          className="flex flex-col gap-2 rounded-[var(--radius-box)] border border-violet/40 bg-violet-wash p-4"
          aria-label="Agent setup"
        >
          <p className="flex items-center gap-2 text-sm">
            <span className="loading loading-spinner loading-xs text-violet" aria-hidden />
            Setting up agent permissions…
            <span className="num text-ash">
              {setup.done}/{setup.total}
            </span>
          </p>
          <progress className="progress progress-primary w-full" value={setup.done} max={setup.total} />
          <p className="text-xs text-smoke">The agent may trade and add collateral. Withdrawals stay yours only.</p>
        </section>
      )}

      {account && delegated && !setup && status?.account && status.account.allowlistDrift.length > 0 && (
        <section className="panel flex flex-col gap-3 p-4" aria-label="Agent setup">
          <h2 className="font-semibold">Finish agent setup</h2>
          <p className="text-sm text-ash">
            Your trading account needs {status.account.allowlistDrift.length} more permission updates before the agent
            can place orders. One fingerprint, then they run on their own.
          </p>
          <button className="btn btn-primary" disabled={pending} onClick={finishSetup}>
            Finish setup
          </button>
        </section>
      )}

      {account && delegated && status?.account && (
        <section className="panel flex flex-col gap-4 p-4">
          <StepHeader
            n={3}
            title="Collateral"
            detail={`${status.collateral.symbol} · read on-chain`}
            isDone={isAccountOpen && isAllowlistOk}
          />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="On the exchange" value={fmt(status.account.balanceCNS)} isHero />
            <Stat label="In your wallet" value={fmt(status.ownerCollateral)} />
            <Stat label="Locked" value={fmt(status.account.lockedBalanceCNS)} />
            <Stat
              label="Minimums"
              value={`open ${PERPL_TESTNET_MIN_OPEN_AUSD} · then ${PERPL_TESTNET_MIN_DEPOSIT_AUSD}`}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">Amount</span>
            <div className="flex items-center rounded-[var(--radius-field)] border border-line bg-raised focus-within:border-violet">
              <input
                className="num w-full bg-transparent px-3 py-2.5 text-[15px] outline-none"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                aria-label="Amount"
              />
              <span className="num pr-3 text-sm text-smoke">{status.collateral.symbol}</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-primary" disabled={pending || !!setup} onClick={deposit}>
              {status.account.accountId === 0n ? "Deposit and open" : "Deposit"}
            </button>
            <button
              className="btn btn-outline border-short/50 text-short hover:border-short hover:bg-short/10"
              disabled={pending || !!setup || status.account.accountId === 0n}
              onClick={withdraw}
            >
              Withdraw
            </button>
          </div>
          <button className="btn btn-ghost btn-sm self-start text-ash" disabled={pending} onClick={requestAusd}>
            Request test AUSD (Agora faucet)
          </button>
        </section>
      )}

      {log.length > 0 && (
        <section className="panel flex flex-col gap-2 p-4" aria-label="Activity">
          <h2 className="label-caps">Activity</h2>
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
    <CheckCircleIcon className="inline h-5 w-5 text-long" aria-label="yes" />
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
  const isFail = / failed|error|unavailable/.test(line);
  const isDone = /confirmed|delegated account:|recovered/.test(line);
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
