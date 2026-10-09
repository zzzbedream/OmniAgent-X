"use client";

import { useEffect, useState } from "react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { TabBar } from "~~/components/omni/TabBar";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { MeraProvider } from "~~/services/mera/MeraProvider";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

// The scaffold's useInitializeNativeCurrencyPrice is not called: it read the ETH price from mainnet Uniswap
// through a shared Alchemy key for a footer widget this app no longer shows, and failed on CORS.
const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      {/* Mera wraps the whole shell so the header can show the signed-in account. */}
      <MeraProvider>
        <div className="flex min-h-screen flex-col">
          <Header />
          <main className="relative flex flex-1 flex-col">{children}</main>
          <Footer />
          <TabBar />
        </div>
      </MeraProvider>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ProgressBar height="2px" color="#836ef9" />
        <RainbowKitProvider
          avatar={BlockieAvatar}
          theme={mounted ? (isDarkMode ? darkTheme() : lightTheme()) : lightTheme()}
        >
          <ScaffoldEthApp>{children}</ScaffoldEthApp>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
