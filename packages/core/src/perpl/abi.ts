// Minimal hand-written ABIs for the deployed Perpl contracts. Signatures are taken from the
// public interfaces in PerplFoundation/delegated-account (interfaces/IExchange.sol, src/*.sol).
// No BUSL-licensed implementation code is copied.
import { parseAbi } from "viem";

export const delegatedAccountFactoryAbi = parseAbi([
  "function EXCHANGE() view returns (address)",
  "function operatorNonces(address) view returns (uint256)",
  "function create(address operator, uint256 opDeadline, bytes opSig) returns (address)",
  "event DelegatedAccountCreated(address indexed proxy, address indexed owner, address indexed operator)",
]);

export const delegatedAccountAbi = parseAbi([
  "function owner() view returns (address)",
  "function exchange() view returns (address)",
  "function collateralToken() view returns (address)",
  "function accountId() view returns (uint256)",
  "function isOperator(address) view returns (bool)",
  "function operatorAllowlist(bytes4) view returns (bool)",
  "function createAccount(uint256 amount)",
  "function withdrawCollateral(uint256 amount)",
  "function removeOperator(address operator)",
  "function setOperatorAllowlist(bytes4 selector, bool allowed)",
]);

const orderDescTuple =
  "(uint256 orderDescId, uint256 perpId, uint8 orderType, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS)";

export const exchangeAbi = parseAbi([
  `function execOrder(${orderDescTuple} orderDesc) returns ((uint256 perpId, uint256 orderId) signature)`,
  "function depositCollateral(uint256 amountCNS)",
  "function getPosition(uint256 perpId, uint256 accountId) view returns ((uint256 accountId, uint256 nextNodeId, uint256 prevNodeId, uint8 positionType, uint256 depositCNS, uint256 pricePNS, uint256 lotLNS, uint256 entryBlock, int256 pnlCNS, int256 deltaPnlCNS, int256 premiumPnlCNS) positionInfo, uint256 markPricePNS, bool markPriceValid)",
  "function getExchangeInfo() view returns (uint256 balanceCNS, uint256 protocolBalanceCNS, uint256 recycleBalanceCNS, uint256 collateralDecimals, address collateralToken, address verifierProxy)",
  "function getAccountById(uint256 accountId) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256 bank1, uint256 bank2, uint256 bank3, uint256 bank4) positions) accountInfo)",
  "function getPerpetualInfo(uint256 perpId) view returns ((string name, string symbol, uint256 priceDecimals, uint256 lotDecimals, bytes32 linkFeedId, uint256 priceTolPer100K, uint256 marginTol, uint256 marginTolDecimals, uint256 refPriceMaxAgeSec, uint256 positionBalanceCNS, uint256 insuranceBalanceCNS, uint256 markPNS, uint256 markTimestamp, uint256 lastPNS, uint256 lastTimestamp, uint256 oraclePNS, uint256 oracleTimestampSec, uint256 longOpenInterestLNS, uint256 shortOpenInterestLNS, uint256 fundingStartBlock, int16 fundingRatePct100k, uint256 absFundingClampPctPer100K, uint8 status, uint256 basePricePNS, uint256 maxBidPriceONS, uint256 minBidPriceONS, uint256 maxAskPriceONS, uint256 minAskPriceONS, uint256 numOrders, bool ignOracle) perpetualInfo)",
]);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
