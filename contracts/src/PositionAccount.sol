// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "./interfaces/Types.sol";
import { IPool, ISpoke } from "./interfaces/Protocols.sol";
import { AaveV3Actions } from "./adapters/AaveV3Actions.sol";
import { AaveV4Actions } from "./adapters/AaveV4Actions.sol";
import { SafeToken } from "./SafeToken.sol";

/// @notice One immutable, venue-bound Aave account for one owner.
/// @dev Protocol calls originate here, so Aave records this address as the user position.
contract PositionAccount {
    /// @notice Immutable address authorized to execute batches and recover idle tokens.
    address public immutable owner;
    /// @notice Immutable Aave version, either 3 or 4.
    uint8 public immutable version;
    /// @notice Immutable Pool or Spoke used for every protocol operation.
    address public immutable venue;
    /// @notice Chain ID recorded at account deployment.
    uint256 public immutable chainId;
    /// @notice Owner-selected position salt recorded at deployment.
    bytes32 public immutable salt;
    /// @notice Deploying address permitted to initialize the account once.
    address public immutable factory;

    /// @notice Whether the factory initialization entry point has already been used.
    bool private initialized;
    /// @notice Reentrancy lock: zero when idle and one while a locked operation runs.
    uint256 private entered;

    /// @notice The caller is not authorized, or factory initialization was already performed.
    error Unauthorized();
    /// @notice The position identity, execution plan, funding, or token configuration is invalid.
    error InvalidPlan();
    /// @notice A risk-increasing batch specifies a minimum health factor below 1e18.
    error InvalidLimits();
    /// @notice The requested Aave version is neither 3 nor 4.
    error UnsupportedVersion();
    /// @notice A callback attempted to enter an already locked operation.
    error Reentered();
    /// @notice The final health factor is below the owner-required minimum.
    /// @param actual Observed final health factor, scaled by 1e18.
    /// @param required Required minimum health factor, scaled by 1e18.
    error Unhealthy(uint256 actual, uint256 required);
    /// @notice The final borrow rate exceeds the owner-selected maximum.
    /// @param actual Observed annualized borrow rate, scaled by 1e27.
    /// @param maximum Maximum permitted annualized borrow rate, scaled by 1e27.
    error BorrowRateExceeded(uint256 actual, uint256 maximum);

    /// @notice Emitted after a protocol action succeeds.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @param kind ActionKind identifier for the requested operation.
    /// @param token Underlying ERC20 token contract.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Actual underlying amount moved; zero for configuration actions.
    /// @param enabled Collateral setting used by supply and collateral-toggle actions.
    event PositionAction(
        address indexed owner,
        uint8 indexed kind,
        address indexed token,
        uint256 reserveId,
        uint256 amount,
        bool enabled
    );
    /// @notice Emitted after a batch and its final checks and refunds succeed.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @param actionCount Number of actions successfully executed in the batch.
    event AccountExecuted(address indexed owner, uint256 actionCount);
    /// @notice Emitted after idle ERC20 tokens are transferred to the owner.
    /// @param owner Position owner and recipient of borrowed or withdrawn assets.
    /// @param token Underlying ERC20 token contract.
    /// @param amount Underlying token amount in the token's smallest units.
    event IdleRecovered(address indexed owner, address indexed token, uint256 amount);

    /// @notice Binds the account to an owner, protocol version, venue, chain, and deploying factory.
    /// @param accountOwner Owner bound to the position account.
    /// @param accountVersion Aave version, either 3 or 4.
    /// @param executionVenue Aave V3 Pool or V4 Spoke contract bound to the account.
    /// @param accountSalt Owner-selected salt used to identify the position.
    constructor(
        address accountOwner,
        uint8 accountVersion,
        address executionVenue,
        bytes32 accountSalt
    ) {
        if (accountOwner == address(0) || executionVenue.code.length == 0) revert InvalidPlan();
        // Keep accepted versions aligned with all three adapter dispatch helpers below.
        if (accountVersion != 3 && accountVersion != 4) revert UnsupportedVersion();
        owner = accountOwner;
        version = accountVersion;
        venue = executionVenue;
        chainId = block.chainid;
        salt = accountSalt;
        factory = msg.sender;
    }

    /// @notice Rejects nested entry into a locked account operation.
    modifier lock() {
        if (entered != 0) revert Reentered();
        entered = 1;
        _;
        entered = 0;
    }

    /// @notice Executes an owner-authorized batch of funded protocol actions.
    /// @dev Reverts atomically if an action or final risk check fails; unused new funding is refunded.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param actions Ordered protocol actions to execute atomically.
    /// @param limits Deadline, minimum health factor, and maximum borrow rate for the batch.
    function execute(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) external onlyOwner lock {
        _execute(funding, actions, limits);
    }

    /// @notice Executes the initial batch immediately after account deployment.
    /// @dev Callable once by the deploying factory. Marks initialization before executing external calls.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param actions Ordered protocol actions to execute atomically.
    /// @param limits Deadline, minimum health factor, and maximum borrow rate for the batch.
    function initialize(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) external lock {
        if (msg.sender != factory || initialized) revert Unauthorized();
        initialized = true;
        _execute(funding, actions, limits);
    }

    /// @notice Transfers idle ERC20 tokens from the account to its owner.
    /// @dev Owner-only and protected against reentrancy.
    /// @param token Underlying ERC20 token contract.
    /// @param amount Amount in token units; type(uint256).max transfers the entire idle balance.
    function recoverIdle(
        address token,
        uint256 amount
    ) external onlyOwner lock {
        if (token == address(0) || token.code.length == 0) revert InvalidPlan();
        if (amount == type(uint256).max) amount = IERC20(token).balanceOf(address(this));
        SafeToken.invoke(token, abi.encodeCall(IERC20.transfer, (owner, amount)));
        emit IdleRecovered(owner, token, amount);
    }

    /// @notice Pulls funding, dispatches actions, checks limits, and refunds unused funding.
    /// @dev Accepts 1 to 64 actions and at most 32 funding entries. Funding must arrive in exact amounts.
    /// @dev Borrow rates are checked after all actions; V4 includes the final account risk premium.
    /// @dev Risk-increasing batches require a minimum health factor of at least 1e18.
    /// @dev Batches containing only risk-reducing actions can repay unhealthy positions without a health-factor check.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param actions Ordered protocol actions to execute atomically.
    /// @param limits Deadline, minimum health factor, and maximum borrow rate for the batch.
    function _execute(
        Funding[] calldata funding,
        Action[] calldata actions,
        Limits calldata limits
    ) private {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > limits.deadline || actions.length == 0 || actions.length > 64 || funding.length > 32) {
            revert InvalidPlan();
        }

        uint256[] memory startingBalances = new uint256[](funding.length);
        for (uint256 i; i < funding.length; ++i) {
            Funding calldata item = funding[i];
            if (item.token == address(0) || item.token.code.length == 0 || item.amount == 0) revert InvalidPlan();
            startingBalances[i] = IERC20(item.token).balanceOf(address(this));
            SafeToken.invoke(item.token, abi.encodeCall(IERC20.transferFrom, (owner, address(this), item.amount)));
            if (IERC20(item.token).balanceOf(address(this)) - startingBalances[i] != item.amount) revert InvalidPlan();
        }

        bool checksRequired;
        for (uint256 i; i < actions.length; ++i) {
            Action calldata action = actions[i];
            (uint256 actual, bool increasesRisk) = _executeAction(action);
            checksRequired = checksRequired || increasesRisk;
            emit PositionAction(owner, action.kind, action.token, action.reserveId, actual, action.enabled);
        }

        // Rate limits are checked against the final account configuration. In V4, changing the
        // collateral basket after borrowing can change the account-specific risk premium.
        for (uint256 i; i < actions.length; ++i) {
            Action calldata action = actions[i];
            if (action.kind != ActionKind.BORROW) continue;
            uint256 finalBorrowRate = _borrowRate(action);
            if (finalBorrowRate > limits.maxBorrowRateRay) {
                revert BorrowRateExceeded(finalBorrowRate, limits.maxBorrowRateRay);
            }
        }

        if (checksRequired) {
            if (limits.minHealthFactor < 1e18) revert InvalidLimits();
            uint256 currentHealthFactor = _healthFactor();
            if (currentHealthFactor < limits.minHealthFactor) {
                revert Unhealthy(currentHealthFactor, limits.minHealthFactor);
            }
        }

        _refundUnusedFunding(funding, startingBalances);
        emit AccountExecuted(owner, actions.length);
    }

    /// @notice Dispatches one action to the adapter for the bound Aave version.
    /// @dev Constructor validation fixes the immutable version to 3 or 4, so the non-V3 path is V4.
    /// @dev Future versions could use a factory-managed mapping(uint8 => address) of approved adapters.
    /// @dev Such a registry must pin the selected adapter per account and preserve its protocol-call context.
    /// @dev Adding a version requires updating constructor validation and all three dispatch helpers together.
    /// @param action Typed action containing the reserve, amount, and collateral setting.
    /// @return actual Underlying tokens supplied, withdrawn, borrowed, or repaid; zero for configuration actions.
    /// @return increasesRisk Whether the batch must enforce the final minimum health factor.
    function _executeAction(
        Action calldata action
    ) private returns (uint256 actual, bool increasesRisk) {
        if (version == 3) return AaveV3Actions.execute(IPool(venue), action, owner);
        return AaveV4Actions.execute(ISpoke(venue), action, owner);
    }

    /// @notice Reads the account health factor from its bound venue.
    /// @dev Constructor validation guarantees that the non-V3 path is V4.
    /// @return Health factor scaled by 1e18.
    function _healthFactor() private view returns (uint256) {
        if (version == 3) return AaveV3Actions.healthFactor(IPool(venue), address(this));
        return AaveV4Actions.healthFactor(ISpoke(venue), address(this));
    }

    /// @notice Reads the current borrow rate relevant to a borrow action.
    /// @dev Constructor validation guarantees that the non-V3 path is V4.
    /// @param action Typed action containing the reserve, amount, and collateral setting.
    /// @return Annualized rate scaled by 1e27, including the account risk premium for V4.
    function _borrowRate(
        Action calldata action
    ) private view returns (uint256) {
        if (version == 3) return AaveV3Actions.borrowRate(IPool(venue), action.token);
        return AaveV4Actions.borrowRate(ISpoke(venue), action.reserveId, action.token, address(this));
    }

    /// @notice Returns unconsumed new funding to the owner.
    /// @dev Groups duplicate token entries and caps refunds at the funded amount and balance increase.
    /// @dev Balances held before this execution are preserved by this refund step.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param startingBalances Account balances before funding, in the same order as the funding entries.
    function _refundUnusedFunding(
        Funding[] calldata funding,
        uint256[] memory startingBalances
    ) private {
        for (uint256 i; i < funding.length; ++i) {
            bool seen;
            for (uint256 j; j < i; ++j) {
                if (funding[j].token == funding[i].token) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;

            uint256 funded;
            for (uint256 j = i; j < funding.length; ++j) {
                if (funding[j].token == funding[i].token) funded += funding[j].amount;
            }
            uint256 current = IERC20(funding[i].token).balanceOf(address(this));
            uint256 delta = current > startingBalances[i] ? current - startingBalances[i] : 0;
            uint256 refund = delta < funded ? delta : funded;
            if (refund != 0) SafeToken.invoke(funding[i].token, abi.encodeCall(IERC20.transfer, (owner, refund)));
        }
    }

    /// @notice Restricts execution to the immutable owner.
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
}
