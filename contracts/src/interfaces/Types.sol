// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The only assets a position account is allowed to move in one execution.
struct Funding {
    address token;
    uint256 amount;
}

/// @notice Typed protocol actions. There is intentionally no arbitrary-call escape hatch.
struct Action {
    uint8 kind;
    address token;
    uint256 reserveId;
    uint256 amount;
    bool enabled;
}

struct Limits {
    uint256 deadline;
    uint256 minHealthFactor;
    uint256 maxBorrowRateRay;
}

library ActionKind {
    uint8 internal constant SUPPLY = 0;
    uint8 internal constant WITHDRAW = 1;
    uint8 internal constant BORROW = 2;
    uint8 internal constant REPAY = 3;
    uint8 internal constant SET_COLLATERAL = 4;
    uint8 internal constant REFRESH = 5;
}

interface IERC20 {
    function balanceOf(
        address account
    ) external view returns (uint256);
    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);
    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);
    function transfer(
        address to,
        uint256 amount
    ) external returns (bool);
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}
