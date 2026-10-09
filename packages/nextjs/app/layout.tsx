import { Inter, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata = getMetadata({
  title: "OmniAgent X",
  description:
    "Copiloto de trading con IA en Monad testnet. La IA propone, las reglas deciden, tú firmas con tu passkey.",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="es" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body>
        {/* One dark theme by design (.stitch/DESIGN.md); the scaffold's theme switch is gone. */}
        <ThemeProvider forcedTheme="dark">
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
