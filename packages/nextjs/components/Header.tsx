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

/** Wordmark: a terminal prompt glyph next to the product name. */
export const Wordmark = () => (
  <Link href="/" className="flex items-center gap-2" aria-label="OmniAgent X, inicio">
    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line-strong bg-violet-wash text-violet">
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M3 4.5 6.5 8 3 11.5M8 11.5h5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
    <span className="text-[15px] font-bold tracking-tight">
      OmniAgent <span className="text-violet">X</span>
    </span>
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
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <Wordmark />

        <nav aria-label="Secciones" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map(({ label, href }) => {
              const isActive = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive ? "bg-violet-wash text-bone" : "text-ash hover:bg-raised hover:text-bone"
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
          <span className="chip-muted hidden sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-long" aria-hidden />
            Monad testnet
          </span>
          {account ? (
            <Link href="/onboard" className="num rounded-md border border-line bg-panel px-2 py-1 text-xs text-ash">
              {shortAddress(account.address)}
            </Link>
          ) : (
            <Link href="/onboard" className="btn btn-primary btn-sm">
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
