import React from "react";

/**
 * Site footer: honest testnet disclaimer. On mobile it leaves room for the fixed tab bar below it.
 */
export const Footer = () => {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-28 pt-10 text-center text-xs text-smoke lg:pb-6">
      <span className="chip-sim">Testnet · no real money</span>
      <p className="mt-3">
        OmniAgent X · Monad Metropolis · Perpl testnet · Mera passkeys. The agent trades; only you can withdraw.
      </p>
    </footer>
  );
};
