// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice An exact ERC20 contribution pulled from the owner for one execution.
struct Funding {
    /// @notice ERC20 pulled from the owner; must be a nonzero contract address.
    address token;
    /// @notice Exact positive amount to transfer, in the smallest token units.
    uint256 amount;
}

/// @notice A protocol operation selected from the fixed ActionKind vocabulary.
/// @dev Arbitrary external calls are intentionally excluded.
struct Action {
    /// @notice Supported numeric operation identifier from ActionKind.
    uint8 kind;
    /// @notice Underlying token; must match the selected reserve.
    address token;
    /// @notice Spoke-local reserve identifier for V4; must be zero for V3.
    uint256 reserveId;
    /// @notice Underlying token amount; max uint256 requests full repayment or withdrawal. Ignored for configuration.
    uint256 amount;
    /// @notice Collateral preference for supply or SET_COLLATERAL; ignored for other actions.
    bool enabled;
}

/// @notice Owner-selected execution deadline and final-position risk limits.
struct Limits {
    /// @notice Last acceptable block timestamp in seconds; execution at this exact timestamp is allowed.
    uint256 deadline;
    /// @notice Final health-factor floor scaled by 1e18; checked only for risk-increasing batches.
    uint256 minHealthFactor;
    /// @notice Final annualized borrow-rate ceiling scaled by 1e27; checked for each borrow action.
    uint256 maxBorrowRateRay;
}

/// @notice Numeric identifiers for the supported protocol operations.
library ActionKind {
    /// @notice Supply underlying assets and set their collateral status.
    uint8 internal constant SUPPLY = 0;
    /// @notice Withdraw supplied assets and forward them to the owner.
    uint8 internal constant WITHDRAW = 1;
    /// @notice Borrow underlying assets and forward them to the owner.
    uint8 internal constant BORROW = 2;
    /// @notice Repay debt using tokens held by the position account.
    uint8 internal constant REPAY = 3;
    /// @notice Enable or disable an existing reserve as collateral.
    uint8 internal constant SET_COLLATERAL = 4;
    /// @notice Refresh dynamic configuration and risk premium; supported only by V4.
    uint8 internal constant REFRESH = 5;
}

/// @notice Minimal ERC20 surface used for funding, approvals, and token transfers.
interface IERC20 {
    /// @notice Returns the token balance held by an address.
    /// @param account Address whose token balance is queried.
    /// @return Token balance in the smallest token units.
    function balanceOf(
        address account
    ) external view returns (uint256);
    /// @notice Returns the remaining amount a spender may transfer for an owner.
    /// @param owner Address whose token allowance is queried.
    /// @param spender Address allowed to spend the tokens.
    /// @return Remaining allowance in token units.
    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);
    /// @notice Sets the caller allowance for a spender.
    /// @param spender Address allowed to spend the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Whether the approval succeeded.
    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);
    /// @notice Transfers tokens from the caller to a recipient.
    /// @param to Recipient of the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Whether the transfer succeeded.
    function transfer(
        address to,
        uint256 amount
    ) external returns (bool);
    /// @notice Transfers tokens using the caller allowance from the source owner.
    /// @param from Address whose tokens are transferred or burned.
    /// @param to Recipient of the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Whether the transfer succeeded.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}
