// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "../src/interfaces/Types.sol";
import { V3ReserveData, V4Reserve, V4AccountData, IPool, ISpoke } from "../src/interfaces/Protocols.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { PositionFactory } from "../src/PositionFactory.sol";

interface UnitVm {
    function warp(
        uint256 timestamp
    ) external;
}

UnitVm constant unitVm = UnitVm(address(uint160(uint256(keccak256("hevm cheat code")))));

contract TestToken is IERC20 {
    string public name;
    uint8 public immutable decimals;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    address public callbackTarget;
    bytes public callbackData;

    constructor(
        string memory tokenName,
        uint8 tokenDecimals
    ) {
        name = tokenName;
        decimals = tokenDecimals;
    }

    function mint(
        address to,
        uint256 amount
    ) external {
        balanceOf[to] += amount;
    }

    function burn(
        address from,
        uint256 amount
    ) external {
        balanceOf[from] -= amount;
    }

    function setCallback(
        address target,
        bytes calldata data
    ) external {
        callbackTarget = target;
        callbackData = data;
    }

    function approve(
        address spender,
        uint256 amount
    ) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(
        address to,
        uint256 amount
    ) external override returns (bool) {
        _callback();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

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

    function _callback() private {
        if (callbackTarget != address(0)) {
            (bool ok,) = callbackTarget.call(callbackData);
            require(ok, "callback");
        }
    }
}

    contract MockV3Pool is IPool {
        TestToken public immutable collateral;
        TestToken public immutable debt;
        TestToken public immutable aToken;
        TestToken public immutable variableDebt;
        uint256 public constant RATE = 5e25;

        constructor(
            TestToken collateralToken,
            TestToken debtToken
        ) {
            collateral = collateralToken;
            debt = debtToken;
            aToken = new TestToken("aToken", 18);
            variableDebt = new TestToken("variableDebt", 6);
        }

        function mintLiquidity(
            uint256 amount
        ) external {
            debt.mint(address(this), amount);
        }

        function forceDebt(
            address account,
            uint256 amount
        ) external {
            variableDebt.mint(account, amount);
        }

        function getReserveData(
            address asset
        ) external view returns (V3ReserveData memory data) {
            if (asset != address(collateral) && asset != address(debt)) return data;
            data.aTokenAddress = address(aToken);
            data.variableDebtTokenAddress = asset == address(debt) ? address(variableDebt) : address(aToken);
            data.currentVariableBorrowRate = uint128(RATE);
        }

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

        function setUserUseReserveAsCollateral(
            address,
            bool
        ) external { }

        function getUserAccountData(
            address user
        ) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
            uint256 c = aToken.balanceOf(user);
            uint256 d = variableDebt.balanceOf(user);
            return (c, d, 0, 8000, 7500, _healthFactor(user));
        }

        function _healthFactor(
            address user
        ) private view returns (uint256) {
            uint256 d = variableDebt.balanceOf(user);
            return d == 0 ? type(uint256).max : (aToken.balanceOf(user) * 2e18) / d;
        }
    }

    contract MockHub {
        uint256 public constant RATE = 5e25;

        function getAssetDrawnRate(
            uint256
        ) external pure returns (uint256) {
            return RATE;
        }
    }

    contract MockV4Spoke is ISpoke {
        TestToken public immutable collateralA;
        TestToken public immutable collateralB;
        TestToken public immutable debt;
        MockHub public immutable hub;
        mapping(uint256 => uint256) public supplied;
        mapping(address => mapping(uint256 => uint256)) public userSupplied;
        mapping(address => mapping(uint256 => uint256)) public userDebt;
        mapping(address => mapping(uint256 => bool)) public enabled;

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

        function mintLiquidity(
            uint256 amount
        ) external {
            debt.mint(address(this), amount);
        }

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

        function setUsingAsCollateral(
            uint256 reserveId,
            bool usingAsCollateral,
            address onBehalfOf
        ) external {
            enabled[onBehalfOf][reserveId] = usingAsCollateral;
        }

        function updateUserRiskPremium(
            address
        ) external { }
        function updateUserDynamicConfig(
            address
        ) external { }

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

        function getUserTotalDebt(
            uint256 reserveId,
            address user
        ) external view returns (uint256) {
            return userDebt[user][reserveId];
        }

        function _token(
            uint256 reserveId
        ) private view returns (address) {
            return reserveId == 0 ? address(collateralA) : reserveId == 1 ? address(collateralB) : address(debt);
        }

        function _healthFactor(
            address user
        ) private view returns (uint256) {
            uint256 debtAmount = userDebt[user][2];
            uint256 collateralValue =
                (enabled[user][0] ? userSupplied[user][0] : 0) + (enabled[user][1] ? userSupplied[user][1] : 0);
            return debtAmount == 0 ? type(uint256).max : (collateralValue * 2e18) / debtAmount;
        }
    }

    contract PositionAccountTest {
        PositionFactory private factory;
        TestToken private collateral;
        TestToken private collateralB;
        TestToken private debt;
        MockV3Pool private pool;
        MockV4Spoke private spoke;

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

        function reenter(
            address account
        ) external {
            PositionAccount(account).execute(new Funding[](0), new Action[](0), Limits(0, 0, 0));
        }

        function _v3() private returns (PositionFactory, TestToken, TestToken, TestToken, MockV3Pool) {
            TestToken c = new TestToken("Collateral", 18);
            TestToken c2 = new TestToken("Collateral2", 18);
            TestToken d = new TestToken("Debt", 6);
            MockV3Pool p = new MockV3Pool(c, d);
            return (new PositionFactory(), c, c2, d, p);
        }

        function _v4() private returns (PositionFactory, TestToken, TestToken, TestToken, MockV4Spoke) {
            TestToken a = new TestToken("CollateralA", 18);
            TestToken b = new TestToken("CollateralB", 18);
            TestToken d = new TestToken("Debt", 6);
            MockV4Spoke s = new MockV4Spoke(a, b, d);
            return (new PositionFactory(), a, b, d, s);
        }

        function _limits(
            uint256 minHealthFactor,
            uint256 maxBorrowRateRay
        ) private view returns (Limits memory) {
            return Limits(block.timestamp + 1 days, minHealthFactor, maxBorrowRateRay);
        }
    }

    contract Actor {
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
