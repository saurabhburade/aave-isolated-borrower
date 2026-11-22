// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "./interfaces/Types.sol";
import { IPool, ISpoke } from "./interfaces/Protocols.sol";
import { AaveV3Actions } from "./adapters/AaveV3Actions.sol";
import { AaveV4Actions } from "./adapters/AaveV4Actions.sol";
import { SafeToken } from "./SafeToken.sol";

/// @notice One immutable, venue-bound Aave account for one owner.
/// @dev Protocol calls originate here, so Aave records this address as the user position.
contract PositionAccount {
    address public immutable owner;
    uint8 public immutable version;
    address public immutable venue;
    uint256 public immutable chainId;
    bytes32 public immutable salt;
    address public immutable factory;

    bool private initialized;
    uint256 private entered;

    error Unauthorized();
    error InvalidPlan();
    error InvalidLimits();
    error UnsupportedVersion();
    error Reentered();
    error Unhealthy(uint256 actual, uint256 required);
    error BorrowRateExceeded(uint256 actual, uint256 maximum);

    event PositionAction(
        address indexed owner,
        uint8 indexed kind,
        address indexed token,
        uint256 reserveId,
        uint256 amount,
        bool enabled
    );
    event AccountExecuted(address indexed owner, uint256 actionCount);
    event IdleRecovered(address indexed owner, address indexed token, uint256 amount);

    constructor(
        address accountOwner,
        uint8 accountVersion,
        address executionVenue,
        bytes32 accountSalt
    ) {
        if (accountOwner == address(0) || executionVenue.code.length == 0) revert InvalidPlan();
        if (accountVersion != 3 && accountVersion != 4) revert UnsupportedVersion();
        owner = accountOwner;
        version = accountVersion;
        venue = executionVenue;
        chainId = block.chainid;
        salt = accountSalt;
        factory = msg.sender;
    }

    modifier lock() {
        if (entered != 0) revert Reentered();
        entered = 1;
        _;
        entered = 0;
    }

    function execute(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) external onlyOwner lock {
        _execute(funding, actions, limits);
    }

    /// @dev Called exactly once by the factory after CREATE2 deployment.
    function initialize(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) external lock {
        if (msg.sender != factory || initialized) revert Unauthorized();
        initialized = true;
        _execute(funding, actions, limits);
    }

    /// @notice Owner-only recovery path for idle ERC20 balances.
    function recoverIdle(
        address token,
        uint256 amount
    ) external onlyOwner lock {
        if (token == address(0) || token.code.length == 0) revert InvalidPlan();
        if (amount == type(uint256).max) amount = IERC20(token).balanceOf(address(this));
        SafeToken.invoke(token, abi.encodeCall(IERC20.transfer, (owner, amount)));
        emit IdleRecovered(owner, token, amount);
    }

    function _execute(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) private {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > limits.deadline || actions.length == 0 || actions.length > 64 || funding.length > 32) {
            revert InvalidPlan();
        }

        uint256[] memory startingBalances = new uint256[](funding.length);
        for (uint256 i; i < funding.length; ++i) {
            Funding calldata item = funding[i];
            if (item.token == address(0) || item.token.code.length == 0 || item.amount == 0) revert InvalidPlan();
            startingBalances[i] = IERC20(item.token).balanceOf(address(this));
            SafeToken.invoke(item.token, abi.encodeCall(IERC20.transferFrom, (owner, address(this), item.amount)));
            if (IERC20(item.token).balanceOf(address(this)) - startingBalances[i] != item.amount) revert InvalidPlan();
        }

        bool checksRequired;
        for (uint256 i; i < actions.length; ++i) {
            Action calldata action = actions[i];
            (uint256 actual, bool increasesRisk) = _executeAction(action);
            checksRequired = checksRequired || increasesRisk;
            emit PositionAction(owner, action.kind, action.token, action.reserveId, actual, action.enabled);
        }

        // Rate limits are checked against the final account configuration. In V4, changing the
        // collateral basket after borrowing can change the account-specific risk premium.
        for (uint256 i; i < actions.length; ++i) {
            Action calldata action = actions[i];
            if (action.kind != ActionKind.BORROW) continue;
            uint256 finalBorrowRate = _borrowRate(action);
            if (finalBorrowRate > limits.maxBorrowRateRay) {
                revert BorrowRateExceeded(finalBorrowRate, limits.maxBorrowRateRay);
            }
        }

        if (checksRequired) {
            if (limits.minHealthFactor < 1e18) revert InvalidLimits();
            uint256 currentHealthFactor = _healthFactor();
            if (currentHealthFactor < limits.minHealthFactor) {
                revert Unhealthy(currentHealthFactor, limits.minHealthFactor);
            }
        }

        _refundUnusedFunding(funding, startingBalances);
        emit AccountExecuted(owner, actions.length);
    }

    function _executeAction(
        Action calldata action
    ) private returns (uint256 actual, bool increasesRisk) {
        if (version == 3) return AaveV3Actions.execute(IPool(venue), action, owner);
        if (version == 4) return AaveV4Actions.execute(ISpoke(venue), action, owner);
        revert UnsupportedVersion();
    }

    function _healthFactor() private view returns (uint256) {
        if (version == 3) return AaveV3Actions.healthFactor(IPool(venue), address(this));
        if (version == 4) return AaveV4Actions.healthFactor(ISpoke(venue), address(this));
        revert UnsupportedVersion();
    }

    function _borrowRate(
        Action calldata action
    ) private view returns (uint256) {
        if (version == 3) return AaveV3Actions.borrowRate(IPool(venue), action.token);
        if (version == 4) {
            return AaveV4Actions.borrowRate(ISpoke(venue), action.reserveId, action.token, address(this));
        }
        revert UnsupportedVersion();
    }

    function _refundUnusedFunding(
        Funding[] calldata funding,
        uint256[] memory startingBalances
    ) private {
        for (uint256 i; i < funding.length; ++i) {
            bool seen;
            for (uint256 j; j < i; ++j) {
                if (funding[j].token == funding[i].token) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;

            uint256 funded;
            for (uint256 j = i; j < funding.length; ++j) {
                if (funding[j].token == funding[i].token) funded += funding[j].amount;
            }
            uint256 current = IERC20(funding[i].token).balanceOf(address(this));
            uint256 delta = current > startingBalances[i] ? current - startingBalances[i] : 0;
            uint256 refund = delta < funded ? delta : funded;
            if (refund != 0) SafeToken.invoke(funding[i].token, abi.encodeCall(IERC20.transfer, (owner, refund)));
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
}
