// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct V3ReserveData {
    uint256 configuration;
    uint128 liquidityIndex;
    uint128 currentLiquidityRate;
    uint128 variableBorrowIndex;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    uint40 lastUpdateTimestamp;
    uint16 id;
    address aTokenAddress;
    address stableDebtTokenAddress;
    address variableDebtTokenAddress;
    address interestRateStrategyAddress;
    uint128 accruedToTreasury;
    uint128 unbacked;
    uint128 isolationModeTotalDebt;
}

interface IPool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256);
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
    function setUserUseReserveAsCollateral(
        address asset,
        bool useAsCollateral
    ) external;
    function getUserAccountData(
        address user
    ) external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
    function getReserveData(
        address asset
    ) external view returns (V3ReserveData memory);
}

interface IHub {
    function getAssetDrawnRate(
        uint256 assetId
    ) external view returns (uint256);
}

struct V4Reserve {
    address underlying;
    address hub;
    uint16 assetId;
    uint8 decimals;
    uint24 collateralRisk;
    uint8 flags;
    uint32 dynamicConfigKey;
}

struct V4AccountData {
    uint256 riskPremium;
    uint256 avgCollateralFactor;
    uint256 healthFactor;
    uint256 totalCollateralValue;
    uint256 totalDebtValueRay;
    uint256 activeCollateralCount;
    uint256 borrowCount;
}

interface ISpoke {
    function supply(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    function withdraw(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    function borrow(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    function repay(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    function setUsingAsCollateral(
        uint256 reserveId,
        bool usingAsCollateral,
        address onBehalfOf
    ) external;
    function updateUserRiskPremium(
        address onBehalfOf
    ) external;
    function updateUserDynamicConfig(
        address onBehalfOf
    ) external;
    function getReserve(
        uint256 reserveId
    ) external view returns (V4Reserve memory);
    function getUserAccountData(
        address user
    ) external view returns (V4AccountData memory);
    function getUserTotalDebt(
        uint256 reserveId,
        address user
    ) external view returns (uint256);
}
