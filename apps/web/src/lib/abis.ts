import { parseAbi } from 'viem';

export const erc20Abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

export const erc20Bytes32MetadataAbi = parseAbi([
  'function name() view returns (bytes32)',
  'function symbol() view returns (bytes32)',
]);

export const v3PoolAbi = parseAbi([
  'function ADDRESSES_PROVIDER() view returns (address)',
  'function getReservesList() view returns (address[])',
  'function getReserveAddressById(uint16 id) view returns (address)',
  'function getReserveData(address asset) view returns (uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt)',
  'function getConfiguration(address asset) view returns (uint256 data)',
  'function getUserConfiguration(address user) view returns (uint256 data)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
]);

export const v3ProviderAbi = parseAbi(['function getPriceOracle() view returns (address)', 'function getPool() view returns (address)']);
export const v3OracleAbi = parseAbi(['function BASE_CURRENCY() view returns (address)', 'function BASE_CURRENCY_UNIT() view returns (uint256)']);

export const v4HubAbi = parseAbi([
  'function getAssetDrawnRate(uint256 assetId) view returns (uint256)',
  'function getAssetLiquidity(uint256 assetId) view returns (uint256)',
  'function getSpokeConfig(uint256 assetId,address spoke) view returns (uint40 addCap,uint40 drawCap,uint24 riskPremiumThreshold,bool active,bool halted)',
  'function getSpokeAddedAssets(uint256 assetId,address spoke) view returns (uint256)',
  'function getSpokeTotalOwed(uint256 assetId,address spoke) view returns (uint256)',
  'function getSpokeDeficitRay(uint256 assetId,address spoke) view returns (uint256)',
]);

export const v4SpokeAbi = parseAbi([
  'function getReserveCount() view returns (uint256)',
  'function getReserve(uint256 reserveId) view returns (address underlying,address hub,uint16 assetId,uint8 decimals,uint24 collateralRisk,uint8 flags,uint32 dynamicConfigKey)',
  'function getReserveConfig(uint256 reserveId) view returns (uint24 collateralRisk,bool paused,bool frozen,bool borrowable,bool receiveSharesEnabled)',
  'function getDynamicReserveConfig(uint256 reserveId,uint32 dynamicConfigKey) view returns (uint16 collateralFactor,uint32 maxLiquidationBonus,uint16 liquidationFee)',
  'function getUserReserveStatus(uint256 reserveId,address user) view returns (bool usingAsCollateral,bool isBorrowing)',
  'function getUserSuppliedAssets(uint256 reserveId,address user) view returns (uint256)',
  'function getUserTotalDebt(uint256 reserveId,address user) view returns (uint256)',
  'function getUserPremiumDebtRay(uint256 reserveId,address user) view returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 riskPremium,uint256 avgCollateralFactor,uint256 healthFactor,uint256 totalCollateralValue,uint256 totalDebtValueRay,uint256 activeCollateralCount,uint256 borrowCount)',
  'function getUserLastRiskPremium(address user) view returns (uint256)',
  'function getReserveDebt(uint256 reserveId) view returns (uint256 drawnDebt,uint256 premiumDebt)',
  'function getReserveSuppliedAssets(uint256 reserveId) view returns (uint256)',
  'function supply(uint256 reserveId,uint256 amount,address onBehalfOf) returns (uint256,uint256)',
  'function withdraw(uint256 reserveId,uint256 amount,address onBehalfOf) returns (uint256,uint256)',
  'function borrow(uint256 reserveId,uint256 amount,address onBehalfOf) returns (uint256,uint256)',
  'function repay(uint256 reserveId,uint256 amount,address onBehalfOf) returns (uint256,uint256)',
  'function setUsingAsCollateral(uint256 reserveId,bool usingAsCollateral,address onBehalfOf)',
  'function updateUserRiskPremium(address onBehalfOf)',
  'function updateUserDynamicConfig(address onBehalfOf)',
]);

export const factoryAbi = parseAbi([
  'event PositionCreated(address indexed owner,address indexed account,address indexed venue,uint8 version,bytes32 salt)',
  'function predictPosition(address owner,uint8 version,address venue,bytes32 salt) view returns (address)',
  'function createPosition(uint8 version,address venue,bytes32 salt,(address token,uint256 amount)[] funding,(uint8 kind,address token,uint256 reserveId,uint256 amount,bool enabled)[] actions,(uint256 deadline,uint256 minHealthFactor,uint256 maxBorrowRateRay) limits) returns (address)',
]);

export const accountAbi = parseAbi([
  'event PositionAction(address indexed owner,uint8 indexed kind,address indexed token,uint256 reserveId,uint256 amount,bool enabled)',
  'event AccountExecuted(address indexed owner,uint256 actionCount)',
  'function owner() view returns (address)',
  'function version() view returns (uint8)',
  'function venue() view returns (address)',
  'function chainId() view returns (uint256)',
  'function salt() view returns (bytes32)',
  'function execute((address,uint256)[],(uint8,address,uint256,uint256,bool)[],(uint256,uint256,uint256))',
  'function recoverIdle(address token,uint256 amount)',
]);
