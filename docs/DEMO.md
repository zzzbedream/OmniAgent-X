# End-to-end demo script (testnet)

Each step lists what must be true before moving on. It doubles as the video script.

## Preconditions
- The worker is deployed and `/health` returns `executionEnabled: true` (only after S2 `--test-order` passed).
- The PWA is deployed on its final HTTPS domain.
- The phone runs iOS 18+ Safari, or Android Chrome with Google Password Manager.
- The owner address (shown after step 1) holds MON for gas and at least 10 of the testnet collateral token.

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
