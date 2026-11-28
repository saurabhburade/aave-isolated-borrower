// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ABI-compatible V3 reserve data layout consumed by the adapter.
/// @dev Field order and types must match the Pool ABI, including fields unused by this application.
struct V3ReserveData {
    /// @notice Packed reserve configuration bitmap.
    uint256 configuration;
    /// @notice Supply interest index scaled by 1e27.
    uint128 liquidityIndex;
    /// @notice Annualized supply rate scaled by 1e27.
    uint128 currentLiquidityRate;
    /// @notice Variable debt interest index scaled by 1e27.
    uint128 variableBorrowIndex;
    /// @notice Annualized variable borrow rate scaled by 1e27.
    uint128 currentVariableBorrowRate;
    /// @notice Legacy stable borrow rate slot, scaled by 1e27.
    uint128 currentStableBorrowRate;
    /// @notice Timestamp of the latest reserve accounting update, in seconds.
    uint40 lastUpdateTimestamp;
    /// @notice Pool-local reserve identifier.
    uint16 id;
    /// @notice Interest-bearing supply receipt token address.
    address aTokenAddress;
    /// @notice Legacy stable debt token address slot.
    address stableDebtTokenAddress;
    /// @notice Variable debt token address.
    address variableDebtTokenAddress;
    /// @notice Reserve interest-rate strategy contract address.
    address interestRateStrategyAddress;
    /// @notice Treasury accrual in scaled aToken units.
    uint128 accruedToTreasury;
    /// @notice Underlying amount minted without backing.
    uint128 unbacked;
    /// @notice Isolation-mode aggregate debt in protocol debt-ceiling units.
    uint128 isolationModeTotalDebt;
}

/// @notice Subset of the Aave V3 Pool interface used by position accounts.
interface IPool {
    /// @notice Supplies underlying assets into a user position.
    /// @dev The caller must approve the venue to pull the underlying tokens.
    /// @param asset Underlying reserve token address.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @param onBehalfOf User whose protocol position is modified.
    /// @param referralCode Protocol referral identifier; the application passes zero.
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;
    /// @notice Borrows underlying assets against a user position.
    /// @param asset Underlying reserve token address.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @param interestRateMode Protocol interest-rate mode; this application uses variable mode (2).
    /// @param referralCode Protocol referral identifier; the application passes zero.
    /// @param onBehalfOf User whose protocol position is modified.
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
    /// @notice Repays underlying assets toward a user debt.
    /// @dev The caller must approve the venue to pull the underlying tokens.
    /// @param asset Underlying reserve token address.
    /// @param amount Requested token amount; type(uint256).max requests repayment of all debt.
    /// @param interestRateMode Protocol interest-rate mode; this application uses variable mode (2).
    /// @param onBehalfOf User whose protocol position is modified.
    /// @return Actual underlying token amount repaid.
    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256);
    /// @notice Withdraws underlying assets from a user position.
    /// @param asset Underlying reserve token address.
    /// @param amount Requested token amount; type(uint256).max requests withdrawal of all supplied tokens.
    /// @param to Recipient of the tokens.
    /// @return Actual underlying token amount withdrawn.
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
    /// @notice Sets whether the caller uses a supplied asset as collateral.
    /// @param asset Underlying reserve token address.
    /// @param useAsCollateral Whether to enable this asset as collateral.
    function setUserUseReserveAsCollateral(
        address asset,
        bool useAsCollateral
    ) external;
    /// @notice Returns aggregate user collateral, debt, borrowing capacity, and health.
    /// @param user User whose protocol position is queried.
    /// @return Total collateral value in the Pool base currency.
    /// @return Total debt value in the Pool base currency.
    /// @return Available borrowing capacity in the Pool base currency.
    /// @return Liquidation threshold in basis points.
    /// @return Loan-to-value ratio in basis points.
    /// @return Health factor scaled by 1e18.
    function getUserAccountData(
        address user
    ) external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
    /// @notice Returns the reserve layout used for token and rate lookups.
    /// @param asset Underlying reserve token address.
    /// @return Reserve configuration, accounting indices, rates, and token addresses.
    function getReserveData(
        address asset
    ) external view returns (V3ReserveData memory);
}

/// @notice Subset of the Aave V4 Hub interface used to read the base borrow rate.
interface IHub {
    /// @notice Returns the current base borrow rate for a Hub asset.
    /// @param assetId Hub-local asset identifier.
    /// @return Annualized drawn rate scaled by 1e27.
    function getAssetDrawnRate(
        uint256 assetId
    ) external view returns (uint256);
}

/// @notice ABI-compatible V4 reserve metadata linking a Spoke reserve to a Hub asset.
/// @dev Field order and types must match the Spoke ABI.
struct V4Reserve {
    /// @notice Underlying ERC20 token address.
    address underlying;
    /// @notice Hub contract holding the reserve liquidity.
    address hub;
    /// @notice Hub-local asset identifier.
    uint16 assetId;
    /// @notice Underlying token decimal precision.
    uint8 decimals;
    /// @notice Collateral risk parameter in basis points.
    uint24 collateralRisk;
    /// @notice Packed reserve status flags.
    uint8 flags;
    /// @notice Key of the latest dynamic reserve configuration.
    uint32 dynamicConfigKey;
}

/// @notice ABI-compatible V4 account risk data returned by a Spoke.
/// @dev Field order and types must match the Spoke ABI.
struct V4AccountData {
    /// @notice Account risk premium in basis points.
    uint256 riskPremium;
    /// @notice Weighted average collateral factor scaled by 1e18.
    uint256 avgCollateralFactor;
    /// @notice Account health factor scaled by 1e18.
    uint256 healthFactor;
    /// @notice Aggregate collateral in the protocol value unit.
    uint256 totalCollateralValue;
    /// @notice Aggregate debt in the protocol value unit, additionally scaled by 1e27.
    uint256 totalDebtValueRay;
    /// @notice Number of enabled, supplied reserves with a positive collateral factor.
    uint256 activeCollateralCount;
    /// @notice Number of reserves with outstanding borrowing.
    uint256 borrowCount;
}

/// @notice Subset of the Aave V4 Spoke interface used by position accounts.
interface ISpoke {
    /// @notice Supplies underlying assets into a user position.
    /// @dev The caller must approve the venue to pull the underlying tokens.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @param onBehalfOf User whose protocol position is modified.
    /// @return Supply shares credited.
    /// @return Underlying tokens supplied.
    function supply(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    /// @notice Withdraws underlying assets from a user position.
    /// @dev Underlying tokens are sent to the caller.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Requested token amount; type(uint256).max requests withdrawal of all supplied tokens.
    /// @param onBehalfOf User whose protocol position is modified.
    /// @return Supply shares removed.
    /// @return Underlying tokens withdrawn.
    function withdraw(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    /// @notice Borrows underlying assets against a user position.
    /// @dev Underlying tokens are sent to the caller.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @param onBehalfOf User whose protocol position is modified.
    /// @return Debt shares added.
    /// @return Underlying tokens borrowed.
    function borrow(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    /// @notice Repays underlying assets toward a user debt.
    /// @dev The caller must approve the venue to pull the underlying tokens.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Requested token amount; type(uint256).max requests repayment of all debt.
    /// @param onBehalfOf User whose protocol position is modified.
    /// @return Debt shares repaid.
    /// @return Underlying tokens repaid.
    function repay(
        uint256 reserveId,
        uint256 amount,
        address onBehalfOf
    ) external returns (uint256, uint256);
    /// @notice Sets whether a user uses a supplied reserve as collateral.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param usingAsCollateral Whether to enable this reserve as collateral.
    /// @param onBehalfOf User whose protocol position is modified.
    function setUsingAsCollateral(
        uint256 reserveId,
        bool usingAsCollateral,
        address onBehalfOf
    ) external;
    /// @notice Refreshes a user risk premium using the current account configuration.
    /// @param onBehalfOf User whose protocol position is modified.
    function updateUserRiskPremium(
        address onBehalfOf
    ) external;
    /// @notice Refreshes the reserve configuration snapshots for a user.
    /// @param onBehalfOf User whose protocol position is modified.
    function updateUserDynamicConfig(
        address onBehalfOf
    ) external;
    /// @notice Returns the metadata for a Spoke-local reserve.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @return Reserve token, Hub linkage, and configuration metadata.
    function getReserve(
        uint256 reserveId
    ) external view returns (V4Reserve memory);
    /// @notice Returns the risk and aggregate position data for a user.
    /// @param user User whose protocol position is queried.
    /// @return Account health, collateral and debt values, premium, and reserve counts.
    function getUserAccountData(
        address user
    ) external view returns (V4AccountData memory);
    /// @notice Returns the user total debt for a reserve, including the risk premium.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param user User whose protocol position is queried.
    /// @return Outstanding debt in underlying token units.
    function getUserTotalDebt(
        uint256 reserveId,
        address user
    ) external view returns (uint256);
}
