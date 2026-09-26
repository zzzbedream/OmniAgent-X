// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IReceiver } from "../contracts/interfaces/IReceiver.sol";
import { OmniReceiverSpike } from "../contracts/spikes/OmniReceiverSpike.sol";

contract OmniReceiverSpikeTest is Test {
    address internal constant FORWARDER = address(0xF0);
    bytes32 internal constant WORKFLOW_ID = keccak256("omniagent-spike");

    OmniReceiverSpike internal receiver;

    function setUp() public {
        receiver = new OmniReceiverSpike(FORWARDER, WORKFLOW_ID);
    }

    function _metadata(bytes32 workflowId) internal pure returns (bytes memory) {
        return abi.encodePacked(workflowId, bytes10("omni-spike"), address(0xABCD));
    }

    function test_AcceptsReportFromForwarder() public {
        vm.prank(FORWARDER);
        receiver.onReport(_metadata(WORKFLOW_ID), abi.encode(uint256(1), "hello"));
        assertEq(receiver.lastSequence(), 1);
        assertEq(receiver.lastNote(), "hello");
    }

    function test_RevertsForOtherSender() public {
        vm.expectRevert(abi.encodeWithSelector(OmniReceiverSpike.InvalidSender.selector, address(this)));
        receiver.onReport(_metadata(WORKFLOW_ID), abi.encode(uint256(1), "x"));
    }

    function test_RevertsForOtherWorkflow() public {
        bytes32 other = keccak256("other");
        vm.prank(FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(OmniReceiverSpike.InvalidWorkflowId.selector, other));
        receiver.onReport(_metadata(other), abi.encode(uint256(1), "x"));
    }

    function test_RevertsOnReplay() public {
        vm.startPrank(FORWARDER);
        receiver.onReport(_metadata(WORKFLOW_ID), abi.encode(uint256(5), "a"));
        vm.expectRevert(abi.encodeWithSelector(OmniReceiverSpike.StaleReport.selector, 5, 5));
        receiver.onReport(_metadata(WORKFLOW_ID), abi.encode(uint256(5), "b"));
        vm.stopPrank();
    }

    function test_RejectsZeroForwarder() public {
        vm.expectRevert(OmniReceiverSpike.InvalidForwarder.selector);
        new OmniReceiverSpike(address(0), WORKFLOW_ID);
    }

    function test_SupportsInterfaces() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xdeadbeef));
    }
}
