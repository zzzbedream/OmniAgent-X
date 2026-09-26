# OmniAgent X: plan para construirlo desde cero (hackathon Monad Metropolis)

## Contexto
El repo `zzzbedream/OmniAgent-X` está vacío: la rama `claude/beautiful-goodall-w5rknl` no tiene commits. El documento de arquitectura propone unir Mera, AUSD, Perpl, Kuru, Chainlink CRE, Qwen, Kimi, x402, Envio, Hunyuan y MetaMask. Revisé cada pieza en su fuente primaria (paquetes npm y repos de GitHub; los sitios de documentación estaban bloqueados por el proxy). Varias afirmaciones del documento **no se sostienen tal como están escritas**. Este plan las corrige y define un MVP que sí se puede construir.

Decisiones que confirmaste:
- Red: **Monad testnet (10143)**.
- Tiempo: **más de 2 semanas**.
- Ejecución: **por fases**. Primero un operador EOA en un worker; después un vault propio + CRE.
- Bounties: núcleo (Agora Trading + Mera + Perpl + CRE/Qwen/Kimi) y los extras solo si sobra tiempo.

---

## 1. Hechos verificados y correcciones al documento

| # | Qué dice el documento | Qué verifiqué | Fuente | Qué implica |
|---|---|---|---|---|
| 1 | Mera = "Monad execution and runtime architecture guide" | Es falso. `@category-labs/mera@0.2.0` es una librería de cuentas a partir de un passkey (PRF). Está en **preview** ("API may change before 1.0") y pide Node ≥24 | npm + `category-labs/mera` | Fijar la versión exacta 0.2.0 |
| 2 | Mera deriva la clave con BIP-39/32 | Parcialmente cierto. Mera **solo** entrega los 32 bytes del PRF y sesiones de firma. La derivación BIP-39/32 la hace la app con `@scure/bip39` y `@scure/bip32` (receta oficial) | `docs/recipes/create-passkey-accounts.mdx` | La derivación es código nuestro. Si la cambiamos, cambian las direcciones |
| 3 | FaceID/TouchID en todos lados | Chrome de escritorio con perfil local, Bitwarden y Dashlane **no dan PRF**. iOS 18+ con Safari/Chrome sí. Android con Google Password Manager sí | `docs/authenticator-support.md` | Detectar `PRF_UNAVAILABLE` y mostrar un mensaje claro. Hacer la demo en iPhone con iOS 18+ |
| 4 | Mera tiene integración con viem | Sí. `@category-labs/mera/viem` → `toViemAccount(session)` firma tx, EIP-712 y EIP-7702 sin mostrar un prompt por firma | `dist/viem.d.ts` | Se conecta directo con wagmi/viem del scaffold |
| 5 | El operador de Perpl es un "contrato de agente inteligente" | **No es posible.** `DelegatedAccount` valida al operador con `ECDSA.recover(...) != _operator`, así que el operador tiene que ser una **EOA** | `PerplFoundation/delegated-account/src/DelegatedAccount.sol:163` | Por eso se construye en dos fases (ver §3) |
| 6 | Perpl: el operador no puede retirar | Correcto. `withdrawCollateral` es solo del owner. La allowlist por defecto es `execOrder(s)`, colateral, `buyLiquidations`, `depositCollateral` y `allowOrderForwarding` | README de delegated-account | Confirma el modelo de custodia |
| 7 | Todo se liquida en AUSD | En **testnet** el colateral de Perpl es un token "USD" (`0xdf5b718d8fcc173335185a2a1513ee8151e3c027`). En mainnet es AUSD (`0x00000000eFE3…012a`), con un mínimo de 10 | `PerplFoundation/api-docs/README.md` | En testnet, "AUSD" es una etiqueta de UI y no un hecho. Hay que decirlo en el pitch |
| 8 | Perpl testnet | Exchange `0x1964C32f…80cc`, Factory `0xf42548Cc…7209`. REST `https://testnet.perpl.xyz/api`, WS `wss://testnet.perpl.xyz`. Mercados: ETH=32, BTC=16, SOL=48, MON=64 | api-docs + delegated-account | Direcciones listas para la config |
| 9 | Perpl API | Autenticación con claves Ed25519 que se enrolan con una firma de wallet. Ejemplos en `examples/` | api-docs | El worker necesita su propia API key |
| 10 | CRE "inyecta transacciones" en Perpl y Kuru | **Falso.** CRE `writeReport` entrega un report firmado vía Forwarder a **tu** contrato, que implementa `IReceiver.onReport`. No hay llamadas arbitrarias | `cre-templates/.../ReceiverTemplate.sol` | Se necesita un contrato receptor propio (OmniVault) |
| 11 | CRE soporta Monad | El SDK `@chainlink/cre-sdk@1.22.0` incluye selectores `monad-testnet` y `monad-mainnet`. **Sin verificar:** que exista un Forwarder desplegado en monad-testnet y que el deploy a un DON real no pida acceso anticipado | `dist/generated/networks.js` | Se prueba en el Spike S3 antes de comprometerse |
| 12 | CRE llama a los LLM "en paralelo" | En modo DON **cada nodo** hace la petición HTTP, lo que multiplica el costo, y un LLM no es determinista, así que el consenso falla. Mitigaciones: `cacheSettings` (un nodo llama y el resto reutiliza), `temperature=0` y consenso sobre campos | README del SDK + template `tokenized-asset-servicing` | Hay que diseñarlo así desde el inicio |
| 13 | El runtime de CRE es TypeScript "normal" | Es QuickJS/Javy compilado a WASM: sin `fetch`, sin `node:*` y sin `setTimeout`. Requiere `bun` y la CLI `cre` | README del SDK | No se pueden usar los SDKs de Perpl, Kuru ni de los LLM dentro del workflow. Solo HTTP crudo |
| 14 | CRE paga x402 firmando Permit2 | No es viable. Cada nodo tendría la clave y pagaría N veces. El secreto tampoco debe vivir en el DON | Deducido de #12 | El pagador x402 es el worker, no CRE |
| 15 | x402 con AUSD en Monad | `@x402/evm@2.27.0` solo trae por defecto **USDC en Monad mainnet (eip155:143)**. No trae 10143 ni AUSD | `dist/esm/chunk-2UXXNYPA.mjs` | x402 en testnet requiere configurar el asset a mano y tener un facilitador que soporte 10143. **Sin verificar** |
| 16 | Kuru en testnet | Sin verificar. Los ejemplos del SDK usan `api.kuru.io` y `ws.staging.kuru.io`. El último commit es del 15 de abril de 2026 | `Kuru-Labs/kuru-sdk` | Solo se integra si el Spike S5 encuentra mercados en testnet |
| 17 | Qwen 3.8 Max y Kimi K2.7 | Existen. Qwen3.8-Max está en Alibaba Model Studio (1M de contexto, function calling, salida estructurada). Kimi K2.7-Code está en platform.moonshot.ai, con API compatible con OpenAI (US$0.95/US$4.00 por millón de tokens) | Búsqueda web (Alibaba Cloud, OpenRouter, HF) | Las dos APIs son HTTP estilo OpenAI y se pueden llamar desde CRE |
| 18 | Scaffold | `monad-developers/scaffold-monad-foundry` usa Next.js + RainbowKit + Foundry, con `targetNetworks: [foundry, monad_testnet]`. Pide Node ≥20.18.3 y Yarn | Repo clonado | Es la base del repo. Mera pide Node ≥24, así que **se usa Node 24** |
| 19 | Licencias | `delegated-account` tiene licencia **BUSL-1.1** | README | **No copiar** su código a OmniVault. Solo interactuar con la Factory desplegada y con la interfaz del Exchange |

Otras correcciones de fondo:
- **Afirmaciones de latencia.** Frases como "resolución de milisegundo" o "miles de veces más rápido" son marketing. En la demo solo se reportan latencias **medidas**.
- **Bounties.** Ganar unas 12 recompensas con un solo producto no es realista. Los jueces premian integraciones profundas.
- **Agora Payments y Agora Trading.** Son dos bounties separados y no sé si se puede competir en ambos con el mismo proyecto. **Hay que confirmarlo con los organizadores.**
- **"App móvil".** Los bounties de Agora hablan de app móvil. No verifiqué si una **PWA** cuenta como tal. **Hay que confirmarlo.**

---

## 2. Arquitectura objetivo (MVP en testnet)

```
[PWA Next.js (scaffold) + Mera passkey]
   │ viem account (toViemAccount)
   ├─ Owner EOA del usuario ──► Perpl DelegatedAccount (Factory oficial)  [Fase 1]
   │                         └► OmniVault (propio)                         [Fase 2]
   │
   ├─ Intención en lenguaje natural ──► /api/strategy (Next route)
   │                                     └► Qwen3.8-Max (plan + riesgo) + Kimi K2.7 (señales JSON)
   │                                     └► Validador determinista (zod + RiskPolicy)
   │
   ├─ Fase 1: Worker Node (operador EOA hot key) ──► DelegatedAccount.execOrder ──► Perpl Exchange
   ├─ Fase 2: CRE workflow (cron/HTTP) ──► LLM vía HTTP con cacheSettings ──► writeReport
   │                                     ──► Forwarder ──► OmniVault.onReport ──► Exchange.execOrder
   │
   └─ Dashboard ◄── Perpl WS (market-data/trading) + Envio HyperIndex (eventos Exchange/OmniVault) + RPC
```

Principio de seguridad: **el LLM propone y el código decide.** Toda salida del modelo pasa por un esquema zod y luego por una `RiskPolicy` determinista, con apalancamiento máximo, notional máximo, mercados permitidos, pérdida diaria máxima y kill-switch. En la Fase 2 esos mismos límites viven también **on-chain** en OmniVault.

---

## 3. Estructura del repo (se crea en la Fase 0)

```
OmniAgent-X/                     ← base: scaffold-monad-foundry (copiado, no fork)
  packages/foundry/
    contracts/OmniVault.sol      ← Fase 2: IReceiver + límites + owner-only withdraw
    contracts/interfaces/IPerplExchange.sol  ← interfaz mínima escrita a mano (no copiar BUSL)
    script/DeployOmniVault.s.sol
    test/OmniVault.t.sol         ← unit + fork test contra testnet-rpc.monad.xyz
  packages/nextjs/
    lib/mera/                    ← createPasskey / signIn / derive (receta oficial) → viem account
    lib/perpl/                   ← REST/WS client, tipos, market ids testnet
    lib/strategy/                ← prompts, esquemas zod, RiskPolicy, clientes Qwen/Kimi (OpenAI-compatible)
    app/onboard, app/intent, app/dashboard
  packages/agent-worker/         ← Fase 1: operador EOA, loop de ejecución, x402 client (Fase 4)
  packages/cre-workflow/         ← Fase 2: `cre init` TS; workflow.ts + config.json + secrets
  packages/indexer/              ← Envio HyperIndex (config.yaml, schema.graphql, handlers)
  docs/ (ARCHITECTURE.md, VERIFIED_FACTS.md, DEMO.md)
```

---

## 4. Fases con compuertas (go/no-go)

### Fase 0: Spikes de validación (días 1–3)
Cada spike tiene un criterio binario de éxito. Si uno falla, se aplica el plan B que indica.

- **S1 Mera PRF.** Crear un passkey en un iPhone con iOS 18+ (Safari) y en Android (Chrome + GPM). Obtener la misma dirección en dos sesiones y firmar una tx en testnet.
  - Plan B: ninguno. Mera es el núcleo del bounty.
- **S2 Perpl testnet.** Con `cast`/`forge`: pedir el token USD de testnet (¿faucet? **sin confirmar**), crear un DelegatedAccount por la Factory, `SetupDelegatedAccountScript` con 10 USD, agregar un operador EOA y ejecutar un `execOrder` en ETH (32) desde el operador.
  - Plan B: si no hay faucet del token USD, pedirlo en el Discord de Perpl.
- **S3 CRE.** `cre init` (TS) y `cre workflow simulate` con `monad-testnet`: una lectura EVM y un `writeReport` a un receptor mínimo. Confirmar que existe una dirección de Forwarder en monad-testnet y si el deploy a un DON necesita acceso anticipado.
  - Plan B: solo simulación local grabada en video, dicho con honestidad en el pitch.
- **S4 LLMs.** Obtener una API key de Alibaba Model Studio (qwen3.8-max) y otra de Moonshot (kimi-k2.7-code). Pedir JSON con esquema y `temperature=0`. Medir latencia y costo por llamada.
- **S5 Kuru, AUSD y x402 en testnet.** Averiguar si hay mercados de Kuru, un contrato AUSD y un facilitador x402 que soporte 10143.
  - Plan B: se descarta la integración que no exista.

### Fase 1: Núcleo de producto (días 4–9)
1. Scaffold con Node 24 y Yarn. Quitar RainbowKit como login principal y poner Mera (onboarding sin frase semilla). Guardar solo metadatos de la credencial en `localStorage`.
2. Onboarding: passkey → dirección → "Crear cuenta de trading", que llama a la Factory de Perpl con la firma del usuario. El operador es la EOA del worker, que firma `AssignOperator` por EIP-712.
3. Intención en lenguaje natural → `/api/strategy`:
   - Kimi extrae señales y parámetros en JSON.
   - Qwen arma el plan con el presupuesto de riesgo.
   - La salida se valida con zod y luego con `RiskPolicy`.
   - El usuario aprueba el plan una vez (firma EIP-712 del plan con el hash de parámetros).
4. El worker lee los planes aprobados, ejecuta `execOrder` vía DelegatedAccount y registra cada decisión (prompt hash, respuesta y tx hash).
5. Retiro: solo el owner, desde la PWA (`withdrawCollateral`).

### Fase 2: Vault propio + Chainlink CRE (días 10–14)
1. `OmniVault.sol` hereda el patrón `ReceiverTemplate`, pero con **código propio** y validando el forwarder y el `workflowId`.
   - Crea su cuenta en el Exchange y guarda `owner` (el usuario Mera).
   - Límites on-chain: mercados, apalancamiento, notional y cooldown.
   - `onReport` decodifica las órdenes y llama a `execOrder`. `withdraw` es solo del owner. `pause` lo pueden llamar el owner y el guardian.
   - Estado particionado por usuario, para no crear hotspots de ejecución paralela.
2. Workflow CRE (cron cada N minutos o trigger HTTP):
   - HTTPClient → Qwen y Kimi, con `cacheSettings` y consenso sobre los campos numéricos redondeados.
   - Lectura EVM del estado de OmniVault.
   - `writeReport`.
3. Tests con Foundry: unitarios más fork contra `https://testnet-rpc.monad.xyz`.

### Fase 3: Dashboard de riesgo (días 12–16, en paralelo)
- Perpl WS `market-data` (order-book, precios) y `trading` (posiciones y fills del account).
- Envio HyperIndex sobre los eventos del Exchange y de OmniVault en monad-testnet (skills de agente de Envio disponibles).
- Métricas: exposición por mercado, margen/colateral, distancia a liquidación, PnL y log de decisiones del agente.

### Fase 4: Extras (solo si la Fase 0 los validó; días 16+)
Orden por retorno/esfuerzo:
1. **x402.** El worker paga a nuestro propio endpoint de "señales premium" (servidor con `@x402/*`), solo si hay facilitador y asset en 10143.
2. **Kuru spot.** Órdenes límite desde el worker, solo si hay mercados en testnet.
3. **Hunyuan.** Resumen visual o avatar del plan.
4. **MetaMask Agent Wallet.** Menor prioridad: agrega un segundo camino de wallet que diluye el foco en Mera.

Dynamic, Privy, Cleanverse y Aurora quedan **fuera de alcance**: compiten con Mera o no aportan al flujo.

### Fase 5: Entrega (últimos 2–3 días)
Demo grabada en un dispositivo real, `docs/VERIFIED_FACTS.md`, diagramas, README con pasos reproducibles y un video de menos de 3 minutos.

---

## 5. Uso de los recursos gratuitos del hackathon

| Recurso | Uso concreto | Cuándo activarlo | Riesgo o restricción |
|---|---|---|---|
| **Tenderly Pro** (1 voucher, ~US$7.2k) | Simular y depurar las tx de OmniVault y DelegatedAccount, alertas sobre reverts, Virtual TestNet si soporta Monad (**sin verificar**) | Al empezar la Fase 1 (sirve todo el evento) | Confirmar que soporta la red Monad |
| **QuickNode Build** (3 meses, solo cuentas nuevas) | RPC dedicada del worker y de CRE (sin rate-limit de la RPC pública) + Streams/Webhooks para notificaciones | Fase 1 | Crear la cuenta **nueva** con el voucher antes de cualquier prueba gratuita |
| **Zerion API Builder** (1 mes) | Vista de portafolio de la wallet del usuario en el dashboard | **Tarde (día ~14)**, para que el mes cubra la demo y el juicio | Confirmar que soporta testnet 10143 |
| Crouton Digital RPC (gratis) | RPC de respaldo en testnet | Fase 0 | Límites no documentados aquí |
| Faucets (Monad, QuickNode, Alchemy, Chainlink) | MON para gas | Fase 0 | 1 MON cada 12–24 h. Pedirlo con anticipación |
| Alchemy MCP / Agent Skills, Envio skills, Zerion skills | Acelerar el desarrollo con agentes de código | Todo el proyecto | Son herramientas de desarrollo, no dependencias del producto |
| Livestreams Metropolis (días 1–4) | Revisar si mencionan requisitos de los bounties de Agora, Perpl y CRE | Fase 0 | — |

No verifiqué si Alibaba o Moonshot dan créditos de LLM a los participantes. **Hay que confirmarlo.**

---

## 6. Puntos de falla y mitigación

1. **PRF no disponible en el dispositivo del juez.** Mitigación: mensaje explícito y demo en un dispositivo propio con iOS 18+.
2. **Pérdida del passkey = pérdida de la cuenta.** Mitigación: mostrar que se sincroniza vía iCloud/GPM y ofrecer exportar la frase semilla derivada (`secret vault`) como respaldo opcional.
3. **La clave caliente del operador (Fase 1) queda comprometida.** Consecuencia: puede operar pero no retirar. Riesgo residual: operaciones dañinas que generen pérdidas. Mitigación: límites en el worker, `resignOperator` y montos de testnet.
4. **LLM alucina o devuelve JSON inválido.** Mitigación: zod + RiskPolicy + límites on-chain. Nunca se ejecuta texto libre.
5. **Consenso de CRE con salidas no deterministas.** Mitigación: `cacheSettings`, `temperature=0` y redondeo antes del consenso.
6. **No hay Forwarder de CRE en monad-testnet o falta acceso al DON.** Mitigación: plan B de simulación (Spike S3).
7. **Cambios en la ABI del Exchange de Perpl** (la allowlist se desincroniza, como avisa su README). Mitigación: `SyncOperatorAllowlistScript` y fork tests.
8. **Mera en preview (0.x) y Node ≥24.** Mitigación: fijar versiones y `.nvmrc`.
9. **Cambios de alcance** (demasiados sponsors). Mitigación: compuertas de la Fase 0 y los extras solo en la Fase 4.
10. **Regulatorio y reputacional** (un agente que opera fondos de terceros). Mitigación: todo en testnet, disclaimers y aprobación explícita del plan.

---

## 7. Pendientes que debes confirmar (no los asumo)
- ¿Una PWA cumple el "app móvil" de los bounties de Agora? ¿Se puede postular a Agora Payments y Agora Trading con el mismo proyecto?
- Reglas exactas de cada bounty elegido (criterios, entregables, fecha límite).
- ¿Hay créditos de Qwen o Kimi para participantes? Si no, ¿qué presupuesto tienes?
- ¿Tienes un dispositivo iOS 18+ o Android con GPM para la demo?

---

## 8. Verificación de punta a punta
- `yarn foundry:test`: unitarios de OmniVault. Fork test con `forge test --fork-url https://testnet-rpc.monad.xyz`.
- `cre workflow simulate` con un report hacia OmniVault desplegado en testnet. Revisar el tx hash en el explorer.
- E2E manual en un dispositivo real:
  1. Crear passkey y obtener la dirección.
  2. Crear el DelegatedAccount y depositar 10 USD de testnet.
  3. Escribir la intención y aprobar el plan.
  4. Ver la orden en Perpl testnet (UI `testnet.perpl.xyz` y WS).
  5. Ver el dashboard actualizado.
  6. Retirar como owner.
  7. Comprobar que el retiro desde el operador **revierte**.
- Playwright (Chromium preinstalado) para las rutas de la PWA que no dependen de WebAuthn. WebAuthn se prueba con el virtual authenticator de CDP y la extensión PRF, **si Chromium la soporta** (sin verificar).

## 9. Primer entregable al aprobar
Fase 0: inicializar el repo desde el scaffold (Node 24), escribir `docs/VERIFIED_FACTS.md` con la tabla §1 y sus fuentes, y dejar scripts para los spikes S1–S3. Commit y push a `claude/beautiful-goodall-w5rknl`.
