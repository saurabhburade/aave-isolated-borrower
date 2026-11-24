/** Chain-qualified identities and JSON-safe API boundaries. Amounts are decimal strings. */
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type ProtocolVersion = 3 | 4;
export interface Freshness { status: 'fresh' | 'stale' | 'unavailable'; observedAt: string | null; blockNumber: string | null; reason?: string }
export interface Asset { id: string; tokenId?: string; address: Address; symbol: string; name: string; decimals: number; reserveId?: string; icon?: string }
export interface Market { preferredDebtReserveIds?: string[]; id: string; chainId: number; version: ProtocolVersion; venue: Address; name: string; network: string; assets: Asset[]; status: 'available' | 'unavailable' | 'unchecked'; reason?: string; verifiedBlock?: string; revision?: string }
export interface CollateralInput { assetId: string; amount: string; enabled: boolean }
export interface BorrowRequest { chainId: number; collaterals: CollateralInput[]; debt: { assetId: string; amount: string } }
export interface RiskMetrics { healthFactor: string | null; ltv: string | null; borrowCapacityUsd: string | null; collateralUsd: string | null; debtUsd: string | null; riskPremiumBps?: string | null }
export interface ReserveConstraint { asset: Asset; supplyRemaining: string | null; borrowRemaining: string | null; liquidity: string | null; supplyUncapped: boolean; borrowUncapped: boolean }
export interface MarketQuote { account?: Address; borrowRateRay?: string; constraints?: ReserveConstraint[]; marketId: string; eligible: boolean; reasons: string[]; executionReasons: string[]; executionError?: 'position_exists'; rateSource: 'market' | 'simulation'; borrowApy: string | null; borrowApr: string | null; baseBorrowApr: string | null; risk: RiskMetrics; liquidity: string | null; supplyCapRemaining: string | null; borrowCapRemaining: string | null; executable: boolean; freshness: Freshness }
export interface Balance { asset: Asset; amount: string; collateralEnabled: boolean; suppliedAmount?: string; accruedInterest?: string | null; apy?: string | null }
export interface Activity { id: string; kind: string; assetSymbol?: string; amount?: string; transactionHash: Hex; timestamp: string; blockNumber: string }
export interface Position { id: string; chainId: number; account: Address; owner: Address; market: Market; salt: Hex; collaterals: Balance[]; debts: Balance[]; risk: RiskMetrics; freshness: Freshness; activity: Activity[]; status: 'open' | 'empty' | 'closed' | 'unknown' }
export interface TransactionCall { to: Address; data: Hex; value: string }
export interface CreationDeployment { factory: Address; accountCreationCode: Hex }
export interface Approval { token: Asset; spender: Address; amount: string; currentAllowance?: string }
export interface ReviewPlan { estimatedBorrowApr?: string; id: string; intentSalt: Hex; owner: Address; account: Address; market: Market; request?: BorrowRequest; managementActions?: ManagementAction[]; approvals: Approval[]; transaction: TransactionCall; riskBefore: RiskMetrics | null; riskAfter: RiskMetrics | null; minHealthFactor: string; maxBorrowRateRay: string; deadline: string; simulatedAtBlock?: string; freshness: Freshness; termsHash: Hex; movements: { asset: Asset; amount: string; direction: 'owner-to-account' | 'account-to-owner' }[] }
export interface ManagementAction { kind: 'supply' | 'withdraw' | 'borrow' | 'repay' | 'repay-all' | 'set-collateral' | 'close'; assetId: string; amount?: string; enabled?: boolean }
export interface ApiError { error: string; code?: string }
