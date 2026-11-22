// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Action, ActionKind, IERC20 } from "../interfaces/Types.sol";
import { IPool, V3ReserveData } from "../interfaces/Protocols.sol";
import { SafeToken } from "../SafeToken.sol";

/// @notice Typed Aave V3 calls made with the position account as msg.sender.
library AaveV3Actions {
    error InvalidReserve();
    error InvalidAction();
    error AmountUnavailable();

    function execute(
        IPool pool,
        Action calldata action,
        address owner
    ) internal returns (uint256 actual, bool increasesRisk) {
        if (action.reserveId != 0 || action.token.code.length == 0) revert InvalidReserve();
        V3ReserveData memory reserve = pool.getReserveData(action.token);

        if (action.kind == ActionKind.SUPPLY) {
            if (reserve.aTokenAddress == address(0) || action.amount == 0 || action.amount == type(uint256).max) {
                revert InvalidAction();
            }
            _approve(action.token, address(pool), action.amount);
            pool.supply(action.token, action.amount, address(this), 0);
            _approve(action.token, address(pool), 0);
            pool.setUserUseReserveAsCollateral(action.token, action.enabled);
            return (action.amount, !action.enabled);
        }

        if (action.kind == ActionKind.WITHDRAW) {
            if (reserve.aTokenAddress == address(0)) revert InvalidReserve();
            uint256 beforeBalance = IERC20(action.token).balanceOf(address(this));
            uint256 withdrawn = pool.withdraw(action.token, action.amount, address(this));
            uint256 afterBalance = IERC20(action.token).balanceOf(address(this));
            uint256 received = afterBalance - beforeBalance;
            if (received < withdrawn) revert AmountUnavailable();
            if (received != 0) SafeToken.invoke(action.token, abi.encodeCall(IERC20.transfer, (owner, received)));
            return (received, true);
        }

        if (action.kind == ActionKind.BORROW) {
            if (reserve.variableDebtTokenAddress == address(0) || action.amount == 0) revert InvalidAction();
            uint256 beforeBalance = IERC20(action.token).balanceOf(address(this));
            pool.borrow(action.token, action.amount, 2, 0, address(this));
            uint256 received = IERC20(action.token).balanceOf(address(this)) - beforeBalance;
            if (received < action.amount) revert AmountUnavailable();
            SafeToken.invoke(action.token, abi.encodeCall(IERC20.transfer, (owner, received)));
            return (received, true);
        }

        if (action.kind == ActionKind.REPAY) {
            if (reserve.variableDebtTokenAddress == address(0)) revert InvalidReserve();
            uint256 debt = IERC20(reserve.variableDebtTokenAddress).balanceOf(address(this));
            uint256 available = IERC20(action.token).balanceOf(address(this));
            uint256 requested = action.amount == type(uint256).max ? debt : action.amount;
            if (requested > debt || requested > available || requested == 0) revert AmountUnavailable();
            _approve(action.token, address(pool), action.amount == type(uint256).max ? available : requested);
            actual = pool.repay(
                action.token, action.amount == type(uint256).max ? type(uint256).max : requested, 2, address(this)
            );
            _approve(action.token, address(pool), 0);
            return (actual, false);
        }

        if (action.kind == ActionKind.SET_COLLATERAL) {
            if (reserve.aTokenAddress == address(0)) revert InvalidReserve();
            pool.setUserUseReserveAsCollateral(action.token, action.enabled);
            return (0, !action.enabled);
        }

        revert InvalidAction();
    }

    function healthFactor(
        IPool pool,
        address account
    ) internal view returns (uint256 value) {
        (,,,,, value) = pool.getUserAccountData(account);
    }

    function borrowRate(
        IPool pool,
        address token
    ) internal view returns (uint256) {
        if (token.code.length == 0) revert InvalidReserve();
        V3ReserveData memory reserve = pool.getReserveData(token);
        if (reserve.variableDebtTokenAddress == address(0)) revert InvalidReserve();
        return uint256(reserve.currentVariableBorrowRate);
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
