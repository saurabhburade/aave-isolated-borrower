// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PositionFactory } from "../src/PositionFactory.sol";

/// @notice Foundry cheatcodes required by this script or fork test.
interface Vm {
    /// @notice Starts recording subsequent operations for broadcast as transactions.
    function startBroadcast() external;
    /// @notice Stops recording operations for broadcast.
    function stopBroadcast() external;
}

/// @notice Deploys only the application factory. Protocol venue addresses stay in the
/// chain-specific manifest and are never invented by this script.
contract Deploy {
    /// @notice Foundry cheatcode interface at the canonical test VM address.
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice Broadcasts deployment of a new application position factory.
    /// @return factory Newly deployed position factory.
    function run() external returns (PositionFactory factory) {
        vm.startBroadcast();
        factory = new PositionFactory();
        vm.stopBroadcast();
    }
}
