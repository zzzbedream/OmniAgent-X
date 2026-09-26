// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IReceiver } from "../interfaces/IReceiver.sol";

/// @title OmniReceiverSpike
/// @notice Spike S3 (docs/PLAN.md §4): minimal CRE receiver to prove `writeReport` reaches Monad testnet.
/// @dev Accepts reports only from the configured Forwarder and, when set, only from one workflow ID.
///      Report payload: abi.encode(uint256 sequence, string note).
contract OmniReceiverSpike is IReceiver {
    address public immutable forwarder;
    bytes32 public immutable expectedWorkflowId;

    uint256 public lastSequence;
    string public lastNote;

    event ReportReceived(bytes32 indexed workflowId, uint256 sequence, string note);

    error InvalidForwarder();
    error InvalidSender(address sender);
    error InvalidWorkflowId(bytes32 received);
    error StaleReport(uint256 sequence, uint256 lastSequence);

    constructor(address _forwarder, bytes32 _expectedWorkflowId) {
        if (_forwarder == address(0)) revert InvalidForwarder();
        forwarder = _forwarder;
        expectedWorkflowId = _expectedWorkflowId;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);
        bytes32 workflowId = _workflowId(metadata);
        if (expectedWorkflowId != bytes32(0) && workflowId != expectedWorkflowId) revert InvalidWorkflowId(workflowId);

        (uint256 sequence, string memory note) = abi.decode(report, (uint256, string));
        if (sequence <= lastSequence) revert StaleReport(sequence, lastSequence);
        lastSequence = sequence;
        lastNote = note;
        emit ReportReceived(workflowId, sequence, note);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @dev Forwarder metadata is abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address owner).
    function _workflowId(bytes calldata metadata) private pure returns (bytes32 id) {
        if (metadata.length < 32) return bytes32(0);
        id = bytes32(metadata[:32]);
    }
}
