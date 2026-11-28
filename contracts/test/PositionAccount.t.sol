// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "../src/interfaces/Types.sol";
import { V3ReserveData, V4Reserve, V4AccountData, IPool, ISpoke } from "../src/interfaces/Protocols.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { PositionFactory } from "../src/PositionFactory.sol";

/// @notice Foundry timestamp cheatcode used by the unit tests.
interface UnitVm {
    /// @notice Sets the test block timestamp.
    /// @param timestamp New block timestamp, in seconds.
    function warp(
        uint256 timestamp
    ) external;
}

/// @dev Foundry cheatcode interface used to move the unit-test clock.
UnitVm constant unitVm = UnitVm(address(uint160(uint256(keccak256("hevm cheat code")))));

/// @notice Unrestricted test ERC20 with minting, burning, and transfer callbacks.
contract TestToken is IERC20 {
    /// @notice Test token display name.
    string public name;
    /// @notice Test token decimal precision.
    uint8 public immutable decimals;
    /// @notice Token balances in smallest token units, indexed by holder.
    mapping(address => uint256) public override balanceOf;
    /// @notice Spending allowances indexed by holder and spender.
    mapping(address => mapping(address => uint256)) public override allowance;
    /// @notice Contract called before transfers; zero disables the callback.
    address public callbackTarget;
    /// @notice Calldata sent to the configured transfer callback.
    bytes public callbackData;

    /// @notice Creates a test token with the supplied display name and decimal precision.
    /// @param tokenName Display name for the test token.
    /// @param tokenDecimals Decimal precision for the test token.
    constructor(
        string memory tokenName,
        uint8 tokenDecimals
    ) {
        name = tokenName;
        decimals = tokenDecimals;
    }

    /// @notice Creates test tokens for a recipient without access restrictions.
    /// @param to Recipient of the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    function mint(
        address to,
        uint256 amount
    ) external {
        balanceOf[to] += amount;
    }

    /// @notice Destroys test tokens from a holder without access restrictions.
    /// @param from Address whose tokens are transferred or burned.
    /// @param amount Underlying token amount in the token's smallest units.
    function burn(
        address from,
        uint256 amount
    ) external {
        balanceOf[from] -= amount;
    }

    /// @notice Configures the external callback executed before each transfer.
    /// @param target Callback contract; zero disables callbacks.
    /// @param data Calldata sent to the callback target.
    function setCallback(
        address target,
        bytes calldata data
    ) external {
        callbackTarget = target;
        callbackData = data;
    }

    /// @notice Sets the caller allowance for a spender.
    /// @param spender Address allowed to spend the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Always true after a successful state update.
    function approve(
        address spender,
        uint256 amount
    ) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @notice Transfers tokens from the caller to a recipient.
    /// @dev Test implementation; transfer operations invoke the configured callback before updating balances.
    /// @param to Recipient of the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Always true after a successful state update.
    function transfer(
        address to,
        uint256 amount
    ) external override returns (bool) {
        _callback();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @notice Transfers tokens using the caller allowance from the source owner.
    /// @dev Test implementation; transfer operations invoke the configured callback before updating balances.
    /// @param from Address whose tokens are transferred or burned.
    /// @param to Recipient of the tokens.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return Always true after a successful state update.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        _callback();
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @notice Invokes the configured transfer callback and propagates its failure.
    function _callback() private {
        if (callbackTarget != address(0)) {
            (bool ok,) = callbackTarget.call(callbackData);
            require(ok, "callback");
        }
    }
}

    /// @notice Deterministic V3 test double with collateral receipts and variable debt tokens.
    contract MockV3Pool is IPool {
        /// @notice Primary test collateral token.
        TestToken public immutable collateral;
        /// @notice Test token used for borrowing and repayment.
        TestToken public immutable debt;
        /// @notice Test receipt token representing supplied collateral.
        TestToken public immutable aToken;
        /// @notice Test token representing variable borrowing.
        TestToken public immutable variableDebt;
        /// @notice Fixed annualized mock borrow rate scaled by 1e27.
        uint256 public constant RATE = 5e25;

        /// @notice Creates the mock reserve configuration and its accounting dependencies.
        /// @param collateralToken Test token accepted as collateral.
        /// @param debtToken Test token used for borrowing and repayment.
        constructor(
            TestToken collateralToken,
            TestToken debtToken
        ) {
            collateral = collateralToken;
            debt = debtToken;
            aToken = new TestToken("aToken", 18);
            variableDebt = new TestToken("variableDebt", 6);
        }

        /// @notice Mints test debt tokens to the mock venue as borrowable liquidity.
        /// @param amount Underlying token amount in the token's smallest units.
        function mintLiquidity(
            uint256 amount
        ) external {
            debt.mint(address(this), amount);
        }

        /// @notice Mints artificial debt to simulate an unhealthy position.
        /// @param account User whose mock debt balance is increased.
        /// @param amount Underlying token amount in the token's smallest units.
        function forceDebt(
            address account,
            uint256 amount
        ) external {
            variableDebt.mint(account, amount);
        }

        /// @notice Models the getReserveData operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param asset Underlying reserve token address.
        /// @return data Mock reserve token addresses and fixed rate, or an empty struct for unknown assets.
        function getReserveData(
            address asset
        ) external view returns (V3ReserveData memory data) {
            if (asset != address(collateral) && asset != address(debt)) return data;
            data.aTokenAddress = address(aToken);
            data.variableDebtTokenAddress = asset == address(debt) ? address(variableDebt) : address(aToken);
            data.currentVariableBorrowRate = uint128(RATE);
        }

        /// @notice Models the supply operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param asset Underlying reserve token address.
        /// @param amount Underlying token amount in the token's smallest units.
        /// @param onBehalfOf User whose protocol position is modified.
        function supply(
            address asset,
            uint256 amount,
            address onBehalfOf,
            uint16
        ) external {
            require(asset == address(collateral), "collateral");
            require(collateral.transferFrom(msg.sender, address(this), amount));
            aToken.mint(onBehalfOf, amount);
        }

        /// @notice Models the borrow operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param asset Underlying reserve token address.
        /// @param amount Underlying token amount in the token's smallest units.
        /// @param mode Mock borrow mode; only variable mode (2) is accepted.
        /// @param onBehalfOf User whose protocol position is modified.
        function borrow(
            address asset,
            uint256 amount,
            uint256 mode,
            uint16,
            address onBehalfOf
        ) external {
            require(asset == address(debt) && mode == 2 && onBehalfOf == msg.sender, "borrow");
            variableDebt.mint(onBehalfOf, amount);
            require(_healthFactor(onBehalfOf) >= 1e18, "unsafe");
            debt.transfer(msg.sender, amount);
        }

        /// @notice Models the repay operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param asset Underlying reserve token address.
        /// @param amount Requested token amount; type(uint256).max requests repayment of all debt.
        /// @param mode Mock borrow mode; only variable mode (2) is accepted.
        /// @param onBehalfOf User whose protocol position is modified.
        /// @return Actual underlying token amount repaid.
        function repay(
            address asset,
            uint256 amount,
            uint256 mode,
            address onBehalfOf
        ) external returns (uint256) {
            require(asset == address(debt) && mode == 2, "repay");
            uint256 owed = variableDebt.balanceOf(onBehalfOf);
            uint256 repaid = amount < owed ? amount : owed;
            require(debt.transferFrom(msg.sender, address(this), repaid));
            variableDebt.burn(onBehalfOf, repaid);
            return repaid;
        }

        /// @notice Models the withdraw operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param asset Underlying reserve token address.
        /// @param amount Requested token amount; type(uint256).max requests withdrawal of all supplied tokens.
        /// @param to Recipient of the tokens.
        /// @return Actual underlying token amount withdrawn.
        function withdraw(
            address asset,
            uint256 amount,
            address to
        ) external returns (uint256) {
            require(asset == address(collateral), "withdraw");
            uint256 supplied = aToken.balanceOf(msg.sender);
            uint256 withdrawn = amount < supplied ? amount : supplied;
            aToken.burn(msg.sender, withdrawn);
            require(_healthFactor(msg.sender) >= 1e18, "unsafe");
            collateral.transfer(to, withdrawn);
            return withdrawn;
        }

        /// @notice Models the setUserUseReserveAsCollateral operation for deterministic unit tests.
        /// @dev No-op: this mock counts all receipt tokens as collateral. Both inputs are intentionally ignored.
        function setUserUseReserveAsCollateral(
            address,
            bool
        ) external { }

        /// @notice Models the getUserAccountData operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param user User whose protocol position is queried.
        /// @return Raw mock collateral balance.
        /// @return Raw mock variable debt balance.
        /// @return Zero borrowing-capacity placeholder.
        /// @return Fixed liquidation-threshold placeholder of 8000 basis points.
        /// @return Fixed LTV placeholder of 7500 basis points.
        /// @return Simplified mock health factor scaled by 1e18.
        function getUserAccountData(
            address user
        ) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
            uint256 c = aToken.balanceOf(user);
            uint256 d = variableDebt.balanceOf(user);
            return (c, d, 0, 8000, 7500, _healthFactor(user));
        }

        /// @notice Computes the simplified mock health factor.
        /// @dev Uses twice the raw collateral balance divided by raw debt, without oracle or decimal normalization.
        /// @param user User whose protocol position is queried.
        /// @return Health factor scaled by 1e18, or max uint256 when there is no debt.
        function _healthFactor(
            address user
        ) private view returns (uint256) {
            uint256 d = variableDebt.balanceOf(user);
            return d == 0 ? type(uint256).max : (aToken.balanceOf(user) * 2e18) / d;
        }
    }

    /// @notice V4 Hub test double exposing a fixed annualized borrow rate.
    contract MockHub {
        /// @notice Fixed annualized mock drawn rate scaled by 1e27.
        uint256 public constant RATE = 5e25;

        /// @notice Returns the fixed mock base borrow rate.
        /// @dev The asset identifier is intentionally ignored.
        /// @return Annualized mock rate scaled by 1e27.
        function getAssetDrawnRate(
            uint256
        ) external pure returns (uint256) {
            return RATE;
        }
    }

    /// @notice V4 test double with two collateral reserves and one debt reserve.
    contract MockV4Spoke is ISpoke {
        /// @notice Collateral token listed at mock reserve zero.
        TestToken public immutable collateralA;
        /// @notice Collateral token listed at mock reserve one.
        TestToken public immutable collateralB;
        /// @notice Test token used for borrowing and repayment.
        TestToken public immutable debt;
        /// @notice Mock Hub supplying the fixed base borrow rate.
        MockHub public immutable hub;
        /// @notice Reserved aggregate supply mapping; this mock tracks active balances in userSupplied.
        mapping(uint256 => uint256) public supplied;
        /// @notice Supplied token amounts indexed by user and reserve.
        mapping(address => mapping(uint256 => uint256)) public userSupplied;
        /// @notice Outstanding token debt indexed by user and reserve.
        mapping(address => mapping(uint256 => uint256)) public userDebt;
        /// @notice Collateral flags indexed by user and reserve.
        mapping(address => mapping(uint256 => bool)) public enabled;

        /// @notice Creates the mock reserve configuration and its accounting dependencies.
        /// @param a First test collateral token.
        /// @param b Second test collateral token.
        /// @param d Test debt token.
        constructor(
            TestToken a,
            TestToken b,
            TestToken d
        ) {
            collateralA = a;
            collateralB = b;
            debt = d;
            hub = new MockHub();
        }

        /// @notice Mints test debt tokens to the mock venue as borrowable liquidity.
        /// @param amount Underlying token amount in the token's smallest units.
        function mintLiquidity(
            uint256 amount
        ) external {
            debt.mint(address(this), amount);
        }

        /// @notice Models the getReserve operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @return data Mock metadata for reserve zero, one, or two.
        function getReserve(
            uint256 reserveId
        ) external view returns (V4Reserve memory data) {
            require(reserveId < 3, "reserve");
            data.underlying = reserveId == 0
                ? address(collateralA)
                : reserveId == 1 ? address(collateralB) : address(debt);
            data.hub = address(hub);
            data.assetId = uint16(reserveId);
            data.decimals = reserveId == 2 ? 6 : 18;
            data.collateralRisk = 100;
        }

        /// @notice Models the supply operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param amount Underlying token amount in the token's smallest units.
        /// @param onBehalfOf User whose protocol position is modified.
        /// @return Supply shares credited.
        /// @return Underlying tokens supplied.
        function supply(
            uint256 reserveId,
            uint256 amount,
            address onBehalfOf
        ) external returns (uint256, uint256) {
            address token = _token(reserveId);
            require(reserveId < 2, "supply reserve");
            require(IERC20(token).transferFrom(msg.sender, address(this), amount));
            userSupplied[onBehalfOf][reserveId] += amount;
            return (amount, amount);
        }

        /// @notice Models the withdraw operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param amount Requested token amount; type(uint256).max requests withdrawal of all supplied tokens.
        /// @param onBehalfOf User whose protocol position is modified.
        /// @return Supply shares removed.
        /// @return Underlying tokens withdrawn.
        function withdraw(
            uint256 reserveId,
            uint256 amount,
            address onBehalfOf
        ) external returns (uint256, uint256) {
            uint256 suppliedAmount = userSupplied[onBehalfOf][reserveId];
            uint256 withdrawn = amount < suppliedAmount ? amount : suppliedAmount;
            userSupplied[onBehalfOf][reserveId] = suppliedAmount - withdrawn;
            require(_healthFactor(onBehalfOf) >= 1e18, "unsafe");
            require(IERC20(_token(reserveId)).transfer(msg.sender, withdrawn));
            return (withdrawn, withdrawn);
        }

        /// @notice Models the borrow operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param amount Underlying token amount in the token's smallest units.
        /// @param onBehalfOf User whose protocol position is modified.
        /// @return Debt shares added.
        /// @return Underlying tokens borrowed.
        function borrow(
            uint256 reserveId,
            uint256 amount,
            address onBehalfOf
        ) external returns (uint256, uint256) {
            require(reserveId == 2, "borrow reserve");
            userDebt[onBehalfOf][reserveId] += amount;
            require(_healthFactor(onBehalfOf) >= 1e18, "unsafe");
            require(debt.transfer(msg.sender, amount));
            return (amount, amount);
        }

        /// @notice Models the repay operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param amount Requested token amount; type(uint256).max requests repayment of all debt.
        /// @param onBehalfOf User whose protocol position is modified.
        /// @return Debt shares repaid.
        /// @return Underlying tokens repaid.
        function repay(
            uint256 reserveId,
            uint256 amount,
            address onBehalfOf
        ) external returns (uint256, uint256) {
            uint256 owed = userDebt[onBehalfOf][reserveId];
            uint256 repaid = amount < owed ? amount : owed;
            require(IERC20(_token(reserveId)).transferFrom(msg.sender, address(this), repaid));
            userDebt[onBehalfOf][reserveId] = owed - repaid;
            return (repaid, repaid);
        }

        /// @notice Models the setUsingAsCollateral operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param usingAsCollateral Whether to enable this reserve as collateral.
        /// @param onBehalfOf User whose protocol position is modified.
        function setUsingAsCollateral(
            uint256 reserveId,
            bool usingAsCollateral,
            address onBehalfOf
        ) external {
            enabled[onBehalfOf][reserveId] = usingAsCollateral;
        }

        /// @notice Models the updateUserRiskPremium operation for deterministic unit tests.
        /// @dev Premium is computed on demand in getUserAccountData; the argument is ignored.
        function updateUserRiskPremium(
            address
        ) external { }
        /// @notice Models the updateUserDynamicConfig operation for deterministic unit tests.
        /// @dev No dynamic configuration is stored; the argument is ignored.
        function updateUserDynamicConfig(
            address
        ) external { }

        /// @notice Models the getUserAccountData operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param user User whose protocol position is queried.
        /// @return data Mock premium, enabled collateral, debt, health, and reserve counts.
        function getUserAccountData(
            address user
        ) external view returns (V4AccountData memory data) {
            data.riskPremium = userDebt[user][2] == 0 ? 0 : (enabled[user][0] && enabled[user][1] ? 100 : 500);
            data.totalCollateralValue =
                (enabled[user][0] ? userSupplied[user][0] : 0) + (enabled[user][1] ? userSupplied[user][1] : 0);
            data.totalDebtValueRay = userDebt[user][2] * 1e9;
            data.healthFactor = _healthFactor(user);
            data.activeCollateralCount = (enabled[user][0] ? 1 : 0) + (enabled[user][1] ? 1 : 0);
            data.borrowCount = userDebt[user][2] == 0 ? 0 : 1;
        }

        /// @notice Models the getUserTotalDebt operation for deterministic unit tests.
        /// @dev Uses simplified mock accounting rather than live protocol pricing, interest, or validation.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @param user User whose protocol position is queried.
        /// @return Outstanding debt in underlying token units.
        function getUserTotalDebt(
            uint256 reserveId,
            address user
        ) external view returns (uint256) {
            return userDebt[user][reserveId];
        }

        /// @notice Resolves a mock reserve to its test token.
        /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
        /// @return Collateral A for zero, collateral B for one, and the debt token otherwise.
        function _token(
            uint256 reserveId
        ) private view returns (address) {
            return reserveId == 0 ? address(collateralA) : reserveId == 1 ? address(collateralB) : address(debt);
        }

        /// @notice Computes the simplified mock health factor.
        /// @dev Uses twice the raw collateral balance divided by raw debt, without oracle or decimal normalization.
        /// @param user User whose protocol position is queried.
        /// @return Health factor scaled by 1e18, or max uint256 when there is no debt.
        function _healthFactor(
            address user
        ) private view returns (uint256) {
            uint256 debtAmount = userDebt[user][2];
            uint256 collateralValue =
                (enabled[user][0] ? userSupplied[user][0] : 0) + (enabled[user][1] ? userSupplied[user][1] : 0);
            return debtAmount == 0 ? type(uint256).max : (collateralValue * 2e18) / debtAmount;
        }
    }

    /// @notice Unit coverage for position isolation, limits, authorization, and atomic execution.
    contract PositionAccountTest {
        /// @notice Position factory used by the test fixture.
        PositionFactory private factory;
        /// @notice Primary test collateral token.
        TestToken private collateral;
        /// @notice Second test collateral token.
        TestToken private collateralB;
        /// @notice Test token used for borrowing and repayment.
        TestToken private debt;
        /// @notice Mock V3 Pool used by the fixture.
        MockV3Pool private pool;
        /// @notice Mock V4 Spoke used by the fixture.
        MockV4Spoke private spoke;

        /// @notice Checks V3 position isolation, full closure, refunds, and cleared protocol approvals.
        function testV3TwoAccountsAndClose() external {
            (PositionFactory f, TestToken c, TestToken unusedC2, TestToken d, MockV3Pool p) = _v3();
            unusedC2;
            factory = f;
            collateral = c;
            debt = d;
            pool = p;
            bytes32 saltA = bytes32(uint256(1));
            bytes32 saltB = bytes32(uint256(2));
            address accountA = factory.predictPosition(address(this), 3, address(pool), saltA);
            address accountB = factory.predictPosition(address(this), 3, address(pool), saltB);
            collateral.mint(address(this), 20e18);
            debt.mint(address(pool), 1_000e6);
            collateral.approve(accountA, 10e18);
            collateral.approve(accountB, 5e18);

            Funding[] memory funding = new Funding[](1);
            funding[0] = Funding(address(collateral), 10e18);
            Action[] memory open = new Action[](2);
            open[0] = Action(ActionKind.SUPPLY, address(collateral), 0, 10e18, true);
            open[1] = Action(ActionKind.BORROW, address(debt), 0, 2e6, false);
            factory.createPosition(3, address(pool), saltA, funding, open, _limits(1.5e18, 1e26));

            funding[0].amount = 5e18;
            open[0].amount = 5e18;
            open[1].amount = 1e6;
            factory.createPosition(3, address(pool), saltB, funding, open, _limits(1.5e18, 1e26));
            require(pool.aToken().balanceOf(accountA) == 10e18, "account A collateral");
            require(pool.aToken().balanceOf(accountB) == 5e18, "account B collateral");
            require(pool.variableDebt().balanceOf(accountA) == 2e6, "account A debt");
            require(pool.variableDebt().balanceOf(accountB) == 1e6, "account B debt");

            debt.approve(accountA, 2e6);
            Funding[] memory repayFunding = new Funding[](1);
            repayFunding[0] = Funding(address(debt), 2e6);
            Action[] memory close = new Action[](2);
            close[0] = Action(ActionKind.REPAY, address(debt), 0, type(uint256).max, false);
            close[1] = Action(ActionKind.WITHDRAW, address(collateral), 0, type(uint256).max, false);
            PositionAccount(accountA).execute(repayFunding, close, _limits(1e18, type(uint256).max));
            require(pool.variableDebt().balanceOf(accountA) == 0, "debt dust");
            require(pool.aToken().balanceOf(accountA) == 0, "collateral dust");
            require(collateral.balanceOf(address(this)) == 15e18, "owner refund");
            require(collateral.allowance(accountA, address(pool)) == 0, "collateral allowance");
            require(debt.allowance(accountA, address(pool)) == 0, "debt allowance");
        }

        /// @notice Checks that two V4 collateral reserves back one account and debt position.
        function testV4TwoCollateralSingleRiskAccount() external {
            (PositionFactory f, TestToken a, TestToken b, TestToken d, MockV4Spoke s) = _v4();
            factory = f;
            collateral = a;
            collateralB = b;
            debt = d;
            spoke = s;
            bytes32 salt = bytes32(uint256(9));
            address account = factory.predictPosition(address(this), 4, address(spoke), salt);
            a.mint(address(this), 10e18);
            b.mint(address(this), 5e18);
            d.mint(address(spoke), 1_000e6);
            a.approve(account, 10e18);
            b.approve(account, 5e18);
            Funding[] memory funding = new Funding[](2);
            funding[0] = Funding(address(a), 10e18);
            funding[1] = Funding(address(b), 5e18);
            Action[] memory actions = new Action[](3);
            actions[0] = Action(ActionKind.SUPPLY, address(a), 0, 10e18, true);
            actions[1] = Action(ActionKind.SUPPLY, address(b), 1, 5e18, true);
            actions[2] = Action(ActionKind.BORROW, address(d), 2, 3e6, false);
            factory.createPosition(4, address(spoke), salt, funding, actions, _limits(1.5e18, 1e26));
            V4AccountData memory data = spoke.getUserAccountData(account);
            require(data.activeCollateralCount == 2, "two active collateral assets");
            require(data.borrowCount == 1 && data.healthFactor > 1.5e18, "native risk");
            require(spoke.userSupplied(account, 0) == 10e18 && spoke.userSupplied(account, 1) == 5e18, "basket");
        }

        /// @notice Checks that a post-borrow collateral change is included in the final V4 rate limit.
        function testV4FinalRiskPremiumRateLimitCoversBasketChanges() external {
            (PositionFactory f, TestToken a, TestToken b, TestToken d, MockV4Spoke s) = _v4();
            address account = f.predictPosition(address(this), 4, address(s), bytes32(uint256(10)));
            a.mint(address(this), 10e18);
            b.mint(address(this), 5e18);
            d.mint(address(s), 1_000e6);
            a.approve(account, 10e18);
            b.approve(account, 5e18);
            Funding[] memory funding = new Funding[](2);
            funding[0] = Funding(address(a), 10e18);
            funding[1] = Funding(address(b), 5e18);
            Action[] memory open = new Action[](3);
            open[0] = Action(ActionKind.SUPPLY, address(a), 0, 10e18, true);
            open[1] = Action(ActionKind.SUPPLY, address(b), 1, 5e18, true);
            open[2] = Action(ActionKind.BORROW, address(d), 2, 3e6, false);
            f.createPosition(4, address(s), bytes32(uint256(10)), funding, open, _limits(1.5e18, 1e26));

            Action[] memory riskyBatch = new Action[](2);
            riskyBatch[0] = Action(ActionKind.BORROW, address(d), 2, 1e6, false);
            riskyBatch[1] = Action(ActionKind.SET_COLLATERAL, address(b), 1, 0, false);
            bool reverted;
            try PositionAccount(account).execute(new Funding[](0), riskyBatch, _limits(1e18, 5e25 + 5e23)) {
                reverted = false;
            } catch {
                reverted = true;
            }
            require(reverted, "final premium rate limit");
            require(s.userDebt(account, 2) == 3e6 && s.enabled(account, 1), "rate rollback");
        }

        /// @notice Checks that a caller other than the immutable owner cannot execute a batch.
        function testUnauthorizedCannotExecute() external {
            (PositionFactory f, TestToken c, TestToken unusedC2, TestToken d, MockV3Pool p) = _v3();
            unusedC2;
            bytes32 salt = bytes32(uint256(7));
            address account = f.predictPosition(address(this), 3, address(p), salt);
            c.mint(address(this), 10e18);
            d.mint(address(p), 1_000e18);
            c.approve(account, 10e18);
            Funding[] memory funding = new Funding[](1);
            funding[0] = Funding(address(c), 10e18);
            Action[] memory actions = new Action[](1);
            actions[0] = Action(ActionKind.SUPPLY, address(c), 0, 10e18, true);
            f.createPosition(3, address(p), salt, funding, actions, _limits(1e18, type(uint256).max));
            Actor attacker = new Actor();
            bool succeeded = attacker.tryExecute(
                PositionAccount(account), new Funding[](0), actions, _limits(1e18, type(uint256).max)
            );
            require(!succeeded, "unauthorized execution");
        }

        /// @notice Checks unsafe withdrawals, expired initialization, and duplicate deployment rejection.
        function testUnsafeWithdrawalExpiredPlanAndDuplicateSalt() external {
            (PositionFactory f, TestToken c, TestToken unusedC2, TestToken d, MockV3Pool p) = _v3();
            unusedC2;
            bytes32 salt = bytes32(uint256(20));
            address account = f.predictPosition(address(this), 3, address(p), salt);
            c.mint(address(this), 10e18);
            d.mint(address(p), 1_000e18);
            c.approve(account, 10e18);
            Funding[] memory funding = new Funding[](1);
            funding[0] = Funding(address(c), 10e18);
            Action[] memory open = new Action[](2);
            open[0] = Action(ActionKind.SUPPLY, address(c), 0, 10e18, true);
            open[1] = Action(ActionKind.BORROW, address(d), 0, 2e18, false);

            unitVm.warp(2);
            bool expired;
            try f.createPosition(3, address(p), salt, funding, open, Limits(1, 1e18, 1e26)) returns (address) {
                expired = false;
            } catch {
                expired = true;
            }
            require(expired && account.code.length == 0 && c.balanceOf(address(this)) == 10e18, "expired atomic");

            c.approve(account, 10e18);
            f.createPosition(3, address(p), salt, funding, open, _limits(1e18, 1e26));
            Action[] memory withdraw = new Action[](1);
            withdraw[0] = Action(ActionKind.WITHDRAW, address(c), 0, 9e18, false);
            bool unsafe;
            try PositionAccount(account).execute(new Funding[](0), withdraw, _limits(1.5e18, type(uint256).max)) {
                unsafe = false;
            } catch {
                unsafe = true;
            }
            require(unsafe && p.aToken().balanceOf(account) == 10e18, "unsafe withdrawal");

            bool duplicate;
            try f.createPosition(3, address(p), salt, funding, open, _limits(1e18, 1e26)) returns (address) {
                duplicate = false;
            } catch {
                duplicate = true;
            }
            require(duplicate, "duplicate salt");
            require(f.predictPosition(address(this), 3, address(p), bytes32(uint256(21))) != account, "new salt");
        }

        /// @notice Checks reserve mismatch and failed risk checks roll back account creation and funding.
        function testCrossVenueAndFailedAtomicCreationLeaveNoCode() external {
            (PositionFactory f, TestToken c, TestToken c2, TestToken d, MockV3Pool p) = _v3();
            bytes32 salt = bytes32(uint256(22));
            address account = f.predictPosition(address(this), 3, address(p), salt);
            c2.mint(address(this), 1e18);
            c2.approve(account, 1e18);
            Funding[] memory funding = new Funding[](1);
            funding[0] = Funding(address(c2), 1e18);
            Action[] memory actions = new Action[](1);
            actions[0] = Action(ActionKind.SUPPLY, address(c2), 0, 1e18, true);
            bool mismatch;
            try f.createPosition(3, address(p), salt, funding, actions, _limits(1e18, type(uint256).max)) returns (
                address
            ) {
                mismatch = false;
            } catch {
                mismatch = true;
            }
            require(mismatch && account.code.length == 0 && c2.balanceOf(address(this)) == 1e18, "venue mismatch");

            salt = bytes32(uint256(23));
            account = f.predictPosition(address(this), 3, address(p), salt);
            c.mint(address(this), 10e18);
            d.mint(address(p), 1_000e6);
            c.approve(account, 10e18);
            funding[0] = Funding(address(c), 10e18);
            actions = new Action[](2);
            actions[0] = Action(ActionKind.SUPPLY, address(c), 0, 10e18, true);
            actions[1] = Action(ActionKind.BORROW, address(d), 0, 2e6, false);
            bool failed;
            try f.createPosition(
                3, address(p), salt, funding, actions, Limits(block.timestamp + 1 days, type(uint256).max, 1e26)
            ) returns (
                address
            ) {
                failed = false;
            } catch {
                failed = true;
            }
            require(failed && account.code.length == 0 && c.balanceOf(address(this)) == 10e18, "atomic rollback");
        }

        /// @notice Checks repayment of an unhealthy account and rejection of a reverting token callback.
        function testRescueRepayAndCallbackReentrancy() external {
            (PositionFactory f, TestToken c, TestToken unusedC2, TestToken d, MockV3Pool p) = _v3();
            unusedC2;
            bytes32 salt = bytes32(uint256(24));
            address account = f.predictPosition(address(this), 3, address(p), salt);
            c.mint(address(this), 10e18);
            d.mint(address(p), 1_000e6);
            c.approve(account, 10e18);
            Funding[] memory funding = new Funding[](1);
            funding[0] = Funding(address(c), 10e18);
            Action[] memory open = new Action[](2);
            open[0] = Action(ActionKind.SUPPLY, address(c), 0, 10e18, true);
            open[1] = Action(ActionKind.BORROW, address(d), 0, 2e6, false);
            f.createPosition(3, address(p), salt, funding, open, _limits(1e18, 1e26));

            p.forceDebt(account, 30e18);
            d.mint(address(this), 30e18 + 2e6);
            d.approve(account, 30e18 + 2e6);
            Funding[] memory rescueFunding = new Funding[](1);
            rescueFunding[0] = Funding(address(d), 30e18 + 2e6);
            Action[] memory repay = new Action[](1);
            repay[0] = Action(ActionKind.REPAY, address(d), 0, type(uint256).max, false);
            PositionAccount(account).execute(rescueFunding, repay, Limits(block.timestamp + 1 days, 100e18, 0));
            require(p.variableDebt().balanceOf(account) == 0, "rescue repay");

            c.setCallback(address(this), abi.encodeCall(this.reenter, (account)));
            bytes32 callbackSalt = bytes32(uint256(25));
            address callbackAccount = f.predictPosition(address(this), 3, address(p), callbackSalt);
            c.approve(callbackAccount, 1e18);
            funding[0] = Funding(address(c), 1e18);
            Action[] memory callbackActions = new Action[](1);
            callbackActions[0] = Action(ActionKind.SUPPLY, address(c), 0, 1e18, true);
            bool reentered;
            try f.createPosition(
                3, address(p), callbackSalt, funding, callbackActions, _limits(1e18, type(uint256).max)
            ) returns (
                address
            ) {
                reentered = false;
            } catch {
                reentered = true;
            }
            require(reentered && callbackAccount.code.length == 0, "callback reentrancy");
        }

        /// @notice Attempts a position execution from a malicious token callback.
        /// @param account Position account being queried or operated on.
        function reenter(
            address account
        ) external {
            PositionAccount(account).execute(new Funding[](0), new Action[](0), Limits(0, 0, 0));
        }

        /// @notice Builds a fresh factory, tokens, and V3 Pool fixture.
        /// @return Fresh position factory.
        /// @return Primary collateral test token.
        /// @return Additional unsupported collateral test token.
        /// @return Debt test token.
        /// @return Mock V3 Pool.
        function _v3() private returns (PositionFactory, TestToken, TestToken, TestToken, MockV3Pool) {
            TestToken c = new TestToken("Collateral", 18);
            TestToken c2 = new TestToken("Collateral2", 18);
            TestToken d = new TestToken("Debt", 6);
            MockV3Pool p = new MockV3Pool(c, d);
            return (new PositionFactory(), c, c2, d, p);
        }

        /// @notice Builds a fresh factory, tokens, and V4 Spoke fixture.
        /// @return Fresh position factory.
        /// @return First collateral test token.
        /// @return Second collateral test token.
        /// @return Debt test token.
        /// @return Mock V4 Spoke.
        function _v4() private returns (PositionFactory, TestToken, TestToken, TestToken, MockV4Spoke) {
            TestToken a = new TestToken("CollateralA", 18);
            TestToken b = new TestToken("CollateralB", 18);
            TestToken d = new TestToken("Debt", 6);
            MockV4Spoke s = new MockV4Spoke(a, b, d);
            return (new PositionFactory(), a, b, d, s);
        }

        /// @notice Builds test limits with a deadline one day after the current timestamp.
        /// @param minHealthFactor Minimum acceptable health factor, scaled by 1e18.
        /// @param maxBorrowRateRay Maximum acceptable annualized borrow rate, scaled by 1e27.
        /// @return Limits using the supplied health-factor floor and borrow-rate ceiling.
        function _limits(
            uint256 minHealthFactor,
            uint256 maxBorrowRateRay
        ) private view returns (Limits memory) {
            return Limits(block.timestamp + 1 days, minHealthFactor, maxBorrowRateRay);
        }
    }

    /// @notice Separate caller used to test position-owner authorization.
    contract Actor {
        /// @notice Attempts execution from a caller distinct from the position owner.
        /// @param account Position account being queried or operated on.
        /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
        /// @param actions Ordered protocol actions to execute atomically.
        /// @param limits Deadline, minimum health factor, and maximum borrow rate for the batch.
        /// @return True if execution succeeded; false if it reverted.
        function tryExecute(
            PositionAccount account,
            Funding[] memory funding,
            Action[] memory actions,
            Limits memory limits
        ) external returns (bool) {
            try account.execute(funding, actions, limits) {
                return true;
            } catch {
                return false;
            }
        }
    }
