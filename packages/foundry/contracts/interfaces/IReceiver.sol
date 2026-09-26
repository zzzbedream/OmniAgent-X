// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Chainlink CRE report receiver. The CRE Forwarder calls `onReport` after verifying DON signatures.
/// Interface as published in smartcontractkit/cre-templates (MIT).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
