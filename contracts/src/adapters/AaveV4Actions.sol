// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Action, ActionKind, IERC20 } from "../interfaces/Types.sol";
import { IHub, ISpoke, V4AccountData, V4Reserve } from "../interfaces/Protocols.sol";
import { SafeToken } from "../SafeToken.sol";

/// @notice Executes typed Aave V4 Spoke operations in the calling position account.
library AaveV4Actions {
    /// @notice The token or reserve does not match the supported venue configuration.
    error InvalidReserve();
    /// @notice The action kind or amount is unsupported for this reserve.
    error InvalidAction();
    /// @notice The requested amount exceeds available debt or balance, or the received amount is insufficient.
    error AmountUnavailable();

    /// @notice Basis-point denominator used to apply the V4 risk premium.
    uint256 internal constant BPS = 10_000;

    /// @notice Executes one supported V4 operation for the calling account.
    /// @dev Borrowed and withdrawn assets are forwarded to the owner; temporary protocol approvals are cleared.
    /// @dev Supply requires a nonzero finite amount. Repay accepts type(uint256).max for full debt repayment.
    /// @dev Full repayment requires enough idle tokens to cover the debt; explicit repayment cannot exceed debt or balance.
    /// @param spoke Aave V4 Spoke to call.
    /// @param action Typed action containing the reserve, amount, and collateral setting.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @return actual Underlying amount moved, or zero for collateral and refresh operations.
    /// @return increasesRisk True for borrowing, withdrawal, or disabling collateral, including supply with collateral disabled.
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

    /// @notice Reads a user health factor from the V4 venue.
    /// @param spoke Aave V4 Spoke to call.
    /// @param account Position account being queried or operated on.
    /// @return Health factor scaled by 1e18.
    function healthFactor(
        ISpoke spoke,
        address account
    ) internal view returns (uint256) {
        return spoke.getUserAccountData(account).healthFactor;
    }

    /// @notice Combines the Hub base rate with the account risk premium.
    /// @dev The basis-point premium adjustment is rounded up to the next ray unit.
    /// @param spoke Aave V4 Spoke to call.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param token Underlying ERC20 token contract.
    /// @param account Position account being queried or operated on.
    /// @return Annualized account borrow rate scaled by 1e27.
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
