// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Action, ActionKind, IERC20 } from "../interfaces/Types.sol";
import { IHub, ISpoke, V4AccountData, V4Reserve } from "../interfaces/Protocols.sol";
import { SafeToken } from "../SafeToken.sol";

/// @notice Typed Aave V4 Spoke calls made with the position account as msg.sender.
library AaveV4Actions {
    error InvalidReserve();
    error InvalidAction();
    error AmountUnavailable();

    uint256 internal constant BPS = 10_000;

    function execute(
        ISpoke spoke,
        Action calldata action,
        address owner
    ) internal returns (uint256 actual, bool increasesRisk) {
        if (action.token.code.length == 0) revert InvalidReserve();
        V4Reserve memory reserve = spoke.getReserve(action.reserveId);
        if (reserve.underlying != action.token || reserve.hub == address(0)) revert InvalidReserve();

        if (action.kind == ActionKind.SUPPLY) {
            if (action.amount == 0 || action.amount == type(uint256).max) revert InvalidAction();
            _approve(action.token, address(spoke), action.amount);
            spoke.supply(action.reserveId, action.amount, address(this));
            _approve(action.token, address(spoke), 0);
            spoke.setUsingAsCollateral(action.reserveId, action.enabled, address(this));
            return (action.amount, !action.enabled);
        }

        if (action.kind == ActionKind.WITHDRAW) {
            uint256 beforeBalance = IERC20(action.token).balanceOf(address(this));
            spoke.withdraw(action.reserveId, action.amount, address(this));
            uint256 received = IERC20(action.token).balanceOf(address(this)) - beforeBalance;
            if (received != 0) SafeToken.invoke(action.token, abi.encodeCall(IERC20.transfer, (owner, received)));
            return (received, true);
        }

        if (action.kind == ActionKind.BORROW) {
            if (action.amount == 0) revert InvalidAction();
            uint256 beforeBalance = IERC20(action.token).balanceOf(address(this));
            spoke.borrow(action.reserveId, action.amount, address(this));
            uint256 received = IERC20(action.token).balanceOf(address(this)) - beforeBalance;
            if (received < action.amount) revert AmountUnavailable();
            SafeToken.invoke(action.token, abi.encodeCall(IERC20.transfer, (owner, received)));
            return (received, true);
        }

        if (action.kind == ActionKind.REPAY) {
            uint256 debt = spoke.getUserTotalDebt(action.reserveId, address(this));
            uint256 available = IERC20(action.token).balanceOf(address(this));
            uint256 requested = action.amount == type(uint256).max ? debt : action.amount;
            if (requested > debt || requested > available || requested == 0) revert AmountUnavailable();
            _approve(action.token, address(spoke), action.amount == type(uint256).max ? available : requested);
            (, actual) = spoke.repay(
                action.reserveId, action.amount == type(uint256).max ? type(uint256).max : requested, address(this)
            );
            _approve(action.token, address(spoke), 0);
            return (actual, false);
        }

        if (action.kind == ActionKind.SET_COLLATERAL) {
            spoke.setUsingAsCollateral(action.reserveId, action.enabled, address(this));
            return (0, !action.enabled);
        }

        if (action.kind == ActionKind.REFRESH) {
            spoke.updateUserDynamicConfig(address(this));
            spoke.updateUserRiskPremium(address(this));
            return (0, false);
        }

        revert InvalidAction();
    }

    function healthFactor(
        ISpoke spoke,
        address account
    ) internal view returns (uint256) {
        return spoke.getUserAccountData(account).healthFactor;
    }

    function borrowRate(
        ISpoke spoke,
        uint256 reserveId,
        address token,
        address account
    ) internal view returns (uint256) {
        if (token.code.length == 0) revert InvalidReserve();
        V4Reserve memory reserve = spoke.getReserve(reserveId);
        if (reserve.underlying != token || reserve.hub == address(0)) revert InvalidReserve();
        uint256 baseRate = IHub(reserve.hub).getAssetDrawnRate(reserve.assetId);
        uint256 premium = spoke.getUserAccountData(account).riskPremium;
        return baseRate + (baseRate * premium + BPS - 1) / BPS;
    }

    function _approve(
        address token,
        address spender,
        uint256 amount
    ) private {
        SafeToken.invoke(token, abi.encodeCall(IERC20.approve, (spender, 0)));
        if (amount != 0) SafeToken.invoke(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }
}
