// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, Limits } from "./interfaces/Types.sol";
import { PositionAccount } from "./PositionAccount.sol";

/// @notice CREATE2 factory for owner/venue/version-bound position accounts.
contract PositionFactory {
    error InvalidPlan();
    error PositionAlreadyExists(address account);

    event PositionCreated(
        address indexed owner, address indexed account, address indexed venue, uint8 version, bytes32 salt
    );

    function createPosition(
        uint8 version,
        address venue,
        bytes32 salt,
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) external returns (address account) {
        if ((version != 3 && version != 4) || venue.code.length == 0) revert InvalidPlan();
        account = predictPosition(msg.sender, version, venue, salt);
        if (account.code.length != 0) revert PositionAlreadyExists(account);

        bytes32 deploymentSalt = _deploymentSalt(msg.sender, version, venue, salt);
        PositionAccount deployed = new PositionAccount{ salt: deploymentSalt }(msg.sender, version, venue, salt);
        if (address(deployed) != account) revert InvalidPlan();
        emit PositionCreated(msg.sender, account, venue, version, salt);
        deployed.initialize(funding, actions, limits);
    }

    function predictPosition(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) public view returns (address) {
        bytes32 deploymentSalt = _deploymentSalt(accountOwner, version, venue, salt);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(PositionAccount).creationCode, abi.encode(accountOwner, version, venue, salt))
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), deploymentSalt, initCodeHash))))
        );
    }

    function _deploymentSalt(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, accountOwner, version, venue, salt));
    }
}
