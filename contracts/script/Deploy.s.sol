// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PositionFactory } from "../src/PositionFactory.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys only the application factory. Protocol venue addresses stay in the
/// chain-specific manifest and are never invented by this script.
contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (PositionFactory factory) {
        vm.startBroadcast();
        factory = new PositionFactory();
        vm.stopBroadcast();
    }
}
