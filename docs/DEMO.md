# End-to-end demo script (testnet)

Each step lists what must be true before moving on. It doubles as the video script.

## Preconditions
- The worker is deployed and `/health` returns `executionEnabled: true` (only after S2 `--test-order` passed).
- The PWA is deployed on its final HTTPS domain.
- The phone runs iOS 18+ Safari, or Android Chrome with Google Password Manager.
- The worker's gas station is on (`/health` → `gasStation.enabled`) and holds MON. A new passkey address gets 0.5 MON and test AUSD automatically on `/onboard`.
- Opening the exchange account needs at least 100 AUSD (testnet minimum, VERIFIED_FACTS).
- On an iPhone, "Crear passkey" always creates a **new** passkey, which means a new address. Returning users press "Ya tengo passkey".

## Steps
1. **Cuenta → Crear passkey.** One biometric prompt, then the address appears.
   - Check: sign out, then "Ya tengo passkey" shows the **same** address.
2. **Crear cuenta de trading.** Signs the consent request (no extra prompt), then the factory tx.
   - Check: the DelegatedAccount address appears, "Owner correcto: true" and "Operador activo: true".
3. **Reparar permisos** (the warning block appears on factory-minted accounts). One tx per selector.
   - Check: the warning disappears.
4. **Depositar y abrir cuenta** (≥ 10).
   - Check: Account ID > 0 and the exchange balance equals the deposit.
5. **Estrategia:** e.g. "Corto pequeño en ETH, bajo riesgo" with a budget of 5.
   - Check: the plan shows orders, the risk policy says "aprobado", and the telemetry shows both models.
6. **Aprobar con passkey y enviar al agente.**
   - Check: the result has `mode: live`, `status: sent` and a tx hash (look it up on the testnet explorer).
7. **Riesgo:** the position appears with size, entry and mark. Side and PnL show once the indexer or the worker log knows the side.
8. **Cerrar** on that row, then sign.
   - Check: `status: sent`, `side` matches step 6, and the position disappears on the next refresh.
9. **Cuenta → Retirar.**
   - Check: the wallet collateral balance increases.
   - Optional: show that the operator key cannot withdraw (S2 or `cast`: the call reverts).

## If something fails
- **Step 6 or 8 reverts:** copy the error from the result (the worker keeps it in `/decisions`). The usual suspects are
  oracle staleness, price bands, and minimum lot size (see VERIFIED_FACTS).
- **`side … is unknown` on close:** the position was not opened by this worker and there is no indexer. Run the indexer.

## Automated run (no phone)
`packages/nextjs/scripts/qa/live-e2e.mjs` runs the same journey as a brand-new user, in headless Chromium with a CDP
virtual authenticator that supports PRF, so Mera derives a real address. It runs against the live PWA, worker and testnet:
passkey → gas station → trading account → allowlist → deposit → plan → live order → position → close → withdraw.
It saves a screenshot per step and a 375px video, and checks the open and close transactions on-chain.

First full pass, 2026-10-09: 11/11 steps. About 145 s end to end, of which 68 s was the 9 allowlist transactions on the
public RPC; another run took 19 s for the same step. The round trip cost 0.01 AUSD.
