// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, Limits } from "./interfaces/Types.sol";
import { PositionAccount } from "./PositionAccount.sol";

/// @notice Deploys deterministic owner-, venue-, and version-bound position accounts.
contract PositionFactory {
    /// @notice The position identity, execution plan, funding, or token configuration is invalid.
    error InvalidPlan();
    /// @notice The predicted position address already contains deployed code.
    /// @param account Predicted address that already contains code.
    error PositionAlreadyExists(address account);

    /// @notice Emitted when a position account is deployed, before its initial batch executes.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @param account Position account being queried or operated on.
    /// @param venue Aave V3 Pool or V4 Spoke contract.
    /// @param version Aave version, either 3 or 4.
    /// @param salt Owner-selected salt distinguishing positions at the same venue.
    event PositionCreated(
        address indexed owner, address indexed account, address indexed venue, uint8 version, bytes32 salt
    );

    /// @notice Deploys and initializes a deterministic position account for the caller.
    /// @dev Deployment and initialization revert together if the initial plan fails.
    /// @dev The owner can approve funding transfers to the predicted address before deployment.
    /// @param version Aave version, either 3 or 4.
    /// @param venue Aave V3 Pool or V4 Spoke contract.
    /// @param salt Owner-selected salt distinguishing positions at the same venue.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param actions Ordered protocol actions to execute atomically.
    /// @param limits Deadline, minimum health factor, and maximum borrow rate for the batch.
    /// @return account Address of the deployed and initialized position account.
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

    /// @notice Computes a position address without deploying the account.
    /// @dev The result includes this factory, the current chain, owner, version, venue, salt, and account creation code.
    /// @dev Prediction does not validate the version or venue.
    /// @dev Changes to account source metadata can change the creation code and predicted CREATE2 address.
    /// @dev Virtual for derived factories and fault-injection tests; creation rejects inconsistent predictions.
    /// @param accountOwner Owner bound to the position account.
    /// @param version Aave version, either 3 or 4.
    /// @param venue Aave V3 Pool or V4 Spoke contract.
    /// @param salt Owner-selected salt distinguishing positions at the same venue.
    /// @return Predicted CREATE2 account address.
    function predictPosition(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) public view virtual returns (address) {
        bytes32 deploymentSalt = _deploymentSalt(accountOwner, version, venue, salt);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(PositionAccount).creationCode, abi.encode(accountOwner, version, venue, salt))
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), deploymentSalt, initCodeHash))))
        );
    }

    /// @notice Derives the CREATE2 salt for the current chain and position identity.
    /// @param accountOwner Owner bound to the position account.
    /// @param version Aave version, either 3 or 4.
    /// @param venue Aave V3 Pool or V4 Spoke contract.
    /// @param salt Owner-selected salt distinguishing positions at the same venue.
    /// @return Hash of the chain ID, owner, version, venue, and owner-selected salt.
    function _deploymentSalt(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, accountOwner, version, venue, salt));
    }
}
