"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { BugAntIcon } from "@heroicons/react/24/outline";
import { NAV_ITEMS } from "~~/components/omni/nav";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useMera } from "~~/services/mera/MeraProvider";

// Mera is the account layer. The scaffold's wallet button and debug page are developer tools only.
const SHOW_DEV_TOOLS = process.env.NEXT_PUBLIC_SHOW_WALLET_CONNECT === "true";

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Wordmark: lowercase name and a signal dot, like an instrument maker's mark. */
export const Wordmark = () => (
  <Link href="/" className="flex items-baseline gap-0.5" aria-label="OmniAgent X, inicio">
    <span className="text-[19px] font-bold tracking-[-0.01em]">omniagent</span>
    <span className="h-1.5 w-1.5 -translate-y-2.5 bg-short" aria-hidden />
  </Link>
);

/**
 * Site header
 */
export const Header = () => {
  const pathname = usePathname();
  const { account } = useMera();
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-3 px-5 lg:px-10">
        <Wordmark />

        <nav aria-label="Secciones" className="hidden lg:block">
          <ul className="flex items-center gap-6">
            {NAV_ITEMS.map(({ label, href }) => {
              const isActive = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={`num border-b py-1 text-[12px] uppercase tracking-[0.14em] transition-colors ${
                      isActive ? "border-bone text-bone" : "border-transparent text-ash hover:text-bone"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
            {SHOW_DEV_TOOLS && (
              <li>
                <Link href="/debug" className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-ash">
                  <BugAntIcon className="h-4 w-4" /> Debug
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <span className="num hidden items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-smoke sm:inline-flex">
            <span className="h-1.5 w-1.5 bg-long" aria-hidden />
            Monad testnet
          </span>
          {account ? (
            <Link
              href="/onboard"
              className="num border border-line-strong px-2.5 py-1.5 text-xs text-ash hover:text-bone"
            >
              {shortAddress(account.address)}
            </Link>
          ) : (
            <Link
              href="/onboard"
              className="num border border-line-strong px-3 py-1.5 text-[12px] uppercase tracking-[0.12em] text-bone hover:border-bone"
            >
              Entrar
            </Link>
          )}
          {SHOW_DEV_TOOLS && <RainbowKitCustomConnectButton />}
          {SHOW_DEV_TOOLS && isLocalNetwork && <FaucetButton />}
        </div>
      </div>
    </header>
  );
};
