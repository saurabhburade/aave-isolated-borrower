// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Action, ActionKind, IERC20 } from "../interfaces/Types.sol";
import { IPool, V3ReserveData } from "../interfaces/Protocols.sol";
import { SafeToken } from "../SafeToken.sol";

/// @notice Executes typed Aave V3 operations in the calling position account.
library AaveV3Actions {
    /// @notice The token or reserve does not match the supported venue configuration.
    error InvalidReserve();
    /// @notice The action kind or amount is unsupported for this reserve.
    error InvalidAction();
    /// @notice The requested amount exceeds available debt or balance, or the received amount is insufficient.
    error AmountUnavailable();

    /// @notice Executes one supported V3 operation for the calling account.
    /// @dev Borrowed and withdrawn assets are forwarded to the owner; temporary protocol approvals are cleared.
    /// @dev Supply requires a nonzero finite amount. Repay accepts type(uint256).max for full debt repayment.
    /// @dev Full repayment requires enough idle tokens to cover the debt; explicit repayment cannot exceed debt or balance.
    /// @param pool Aave V3 Pool to call.
    /// @param action Typed action containing the reserve, amount, and collateral setting.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @return actual Underlying amount moved, or zero for collateral-setting actions.
    /// @return increasesRisk True for borrowing, withdrawal, or disabling collateral, including supply with collateral disabled.
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

    /// @notice Reads a user health factor from the V3 venue.
    /// @param pool Aave V3 Pool to call.
    /// @param account Position account being queried or operated on.
    /// @return value Health factor scaled by 1e18.
    function healthFactor(
        IPool pool,
        address account
    ) internal view returns (uint256 value) {
        (,,,,, value) = pool.getUserAccountData(account);
    }

    /// @notice Reads the reserve variable borrow rate.
    /// @param pool Aave V3 Pool to call.
    /// @param token Underlying ERC20 token contract.
    /// @return Annualized variable borrow rate scaled by 1e27.
    function borrowRate(
        IPool pool,
        address token
    ) internal view returns (uint256) {
        if (token.code.length == 0) revert InvalidReserve();
        V3ReserveData memory reserve = pool.getReserveData(token);
        if (reserve.variableDebtTokenAddress == address(0)) revert InvalidReserve();
        return uint256(reserve.currentVariableBorrowRate);
    }

    /// @notice Resets the token allowance to zero before setting the requested allowance.
    /// @param token Underlying ERC20 token contract.
    /// @param spender Address allowed to spend the tokens.
    /// @param amount New allowance in token units; zero only clears the allowance.
    function _approve(
        address token,
        address spender,
        uint256 amount
    ) private {
        SafeToken.invoke(token, abi.encodeCall(IERC20.approve, (spender, 0)));
        if (amount != 0) SafeToken.invoke(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }
}
