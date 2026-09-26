"use client";

// Phase 1 onboarding: passkey (Mera) → Perpl DelegatedAccount with the worker as operator → deposit → withdraw.
// Every write is signed by the passkey-derived owner key; the operator can never withdraw.
import { useCallback, useEffect, useState } from "react";
import {
  APPROVAL_DOMAIN,
  type AllowlistChange,
  CONSENT_REQUEST_TYPES,
  PERPL_TESTNET,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  erc20Abi,
  exchangeAbi,
  readAllowlistDrift,
  readCollateral,
  readDelegatedAccount,
} from "@omniagent/core";
import type { NextPage } from "next";
import { type Address, formatEther, formatUnits, isAddress, parseEventLogs, parseUnits } from "viem";
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

const Onboard: NextPage = () => {
  const { account, walletClient, busy, error, create, signIn, end } = useMera();
  const [userName, setUserName] = useState("");
  const [status, setStatus] = useState<Status>();
  const [delegated, setDelegated] = useState<Address>();
  const [amount, setAmount] = useState("10");
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const push = (line: string) => setLog(prev => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 30));

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
  }, [account, delegated]);

  useEffect(() => {
    if (account) setDelegated(loadDelegatedAccount(account.address));
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      push(`${label} falló: ${(e as Error).message.split("\n")[0]}`);
      return undefined;
    } finally {
      setPending(false);
      void refresh();
    }
  };

  const createTradingAccount = async () => {
    if (!account || !walletClient) return;
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
      push(`worker no disponible: ${(e as Error).message}`);
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

  const withdraw = async () => {
    if (!walletClient || !status?.account) return;
    const acc = status.account;
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

  return (
    <div className="flex flex-col grow pt-8 px-4 gap-6 max-w-xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Cuenta</h1>

      <section className="card bg-base-100 shadow p-4 gap-3">
        <h2 className="font-semibold">1 · Passkey (Mera)</h2>
        {!account ? (
          <>
            <input
              className="input input-bordered w-full"
              placeholder="Nombre para el passkey (p. ej. tu email)"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              aria-label="Nombre del passkey"
            />
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary" disabled={busy || !userName} onClick={() => create(userName)}>
                Crear passkey
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={signIn}>
                Ya tengo passkey
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm break-all">{account.address}</span>
            <button className="btn btn-ghost btn-sm" onClick={end}>
              Cerrar sesión
            </button>
          </div>
        )}
        {error && <p className="text-error text-sm">{error}</p>}
        {account && status && <p className="text-sm">Gas: {formatEther(status.monBalance)} MON</p>}
      </section>

      {account && (
        <section className="card bg-base-100 shadow p-4 gap-3">
          <h2 className="font-semibold">2 · Cuenta de trading (Perpl DelegatedAccount)</h2>
          <p className="text-sm opacity-70">
            El agente (operador <span className="font-mono">{status?.operator ?? "?"}</span>, modo {status?.workerMode})
            puede operar pero no retirar.
          </p>
          {!delegated ? (
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary" disabled={pending} onClick={createTradingAccount}>
                Crear cuenta de trading
              </button>
              <input
                className="input input-bordered input-sm w-full"
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
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt>Cuenta delegada</dt>
              <dd className="font-mono break-all">{delegated}</dd>
              <dt>Owner correcto</dt>
              <dd>{status?.account ? String(status.account.owner === account.address) : "—"}</dd>
              <dt>Operador activo</dt>
              <dd>{status?.account?.isOperator === undefined ? "—" : String(status.account.isOperator)}</dd>
              <dt>Account ID (exchange)</dt>
              <dd>{status?.account?.accountId.toString() ?? "—"}</dd>
              <dt>Balance exchange</dt>
              <dd>{fmt(status?.account?.balanceCNS)}</dd>
              <dt>Bloqueado</dt>
              <dd>{fmt(status?.account?.lockedBalanceCNS)}</dd>
              <dt>Tu colateral (wallet)</dt>
              <dd>{fmt(status?.ownerCollateral)}</dd>
            </dl>
          )}
        </section>
      )}

      {account && delegated && status?.account && status.account.allowlistDrift.length > 0 && (
        <section className="card bg-base-100 shadow p-4 gap-3 border border-warning">
          <h2 className="font-semibold">Permisos del agente desactualizados</h2>
          <p className="text-sm">
            La Factory de Perpl en testnet crea cuentas con una allowlist antigua: el agente todavía no puede llamar a{" "}
            <code>execOrder</code>. Esto aplica los mismos cambios que el script oficial de Perpl (
            {status.account.allowlistDrift.length} transacciones firmadas por ti).
          </p>
          <ul className="text-xs list-disc pl-5">
            {status.account.allowlistDrift.map(c => (
              <li key={c.selector}>
                {c.allowed ? "permitir" : "revocar"} {c.name} ({c.selector})
              </li>
            ))}
          </ul>
          <button className="btn btn-warning" disabled={pending} onClick={repairAllowlist}>
            Reparar permisos
          </button>
        </section>
      )}

      {account && delegated && status?.account && (
        <section className="card bg-base-100 shadow p-4 gap-3">
          <h2 className="font-semibold">3 · Depositar / retirar</h2>
          <p className="text-xs opacity-70">
            Colateral: {status.collateral.symbol} ({status.collateral.token}), leído on-chain del Exchange. En testnet
            no es AUSD real. Mínimo de apertura documentado: 10.
          </p>
          <input
            className="input input-bordered w-full"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            aria-label="Monto"
          />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={deposit}>
              {status.account.accountId === 0n ? "Depositar y abrir cuenta" : "Depositar"}
            </button>
            <button className="btn" disabled={pending || status.account.accountId === 0n} onClick={withdraw}>
              Retirar
            </button>
          </div>
        </section>
      )}

      {log.length > 0 && <pre className="text-xs bg-base-300 p-3 rounded whitespace-pre-wrap">{log.join("\n")}</pre>}
    </div>
  );
};

export default Onboard;
