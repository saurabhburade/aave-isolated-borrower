// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits } from "../src/interfaces/Types.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { PositionFactory } from "../src/PositionFactory.sol";
import { TestToken, MockV3Pool, MockV4Spoke } from "./PositionAccount.t.sol";

/// @notice Foundry gas snapshot cheatcodes used by the benchmark suite.
interface GasBenchmarkVm {
    /// @notice Records the gas consumed by the last external call.
    /// @param group Gas snapshot group name.
    /// @param name Snapshot name within the benchmark group.
    /// @return Gas consumed by the recorded call.
    function snapshotGasLastCall(
        string calldata group,
        string calldata name
    ) external returns (uint256);
    /// @notice Starts measuring a named gas snapshot region.
    /// @param group Gas snapshot group name.
    /// @param name Snapshot name within the benchmark group.
    function startSnapshotGas(
        string calldata group,
        string calldata name
    ) external;
    /// @notice Stops the active gas snapshot region.
    /// @return Gas consumed in the measured region.
    function stopSnapshotGas() external returns (uint256);
}

/// @notice Deterministic successful-call baselines; run with --isolate.
/// @dev Reuses unit-test protocol mocks. No live RPC or public-chain transaction is involved.
contract GasBenchmarksTest {
    /// @notice Foundry cheatcode interface at the canonical test VM address.
    GasBenchmarkVm private constant vm = GasBenchmarkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @notice Position factory used by the test fixture.
    PositionFactory private factory;
    /// @notice Primary test collateral token.
    TestToken private collateral;
    /// @notice Second test collateral token.
    TestToken private secondCollateral;
    /// @notice Test token used for borrowing and repayment.
    TestToken private debt;
    /// @notice Mock V3 Pool used by the fixture.
    MockV3Pool private pool;
    /// @notice Mock V4 Spoke used by the fixture.
    MockV4Spoke private spoke;
    /// @notice Initialized V3 position used for execution benchmarks.
    PositionAccount private v3;
    /// @notice Initialized V4 position with one collateral reserve.
    PositionAccount private v4;
    /// @notice Initialized V4 position with two collateral reserves.
    PositionAccount private basket;

    /// @notice Builds funded V3, V4, and two-collateral V4 positions with token approvals.
    function setUp() external {
        factory = new PositionFactory();
        collateral = new TestToken("Collateral", 18);
        secondCollateral = new TestToken("Second collateral", 18);
        debt = new TestToken("Debt", 6);
        pool = new MockV3Pool(collateral, debt);
        spoke = new MockV4Spoke(collateral, secondCollateral, debt);
        collateral.mint(address(this), 100e18);
        secondCollateral.mint(address(this), 100e18);
        debt.mint(address(this), 1_000e6);
        pool.mintLiquidity(1_000e6);
        spoke.mintLiquidity(1_000e6);
        v3 = _open(3, 1, true, bytes32(uint256(1)));
        v4 = _open(4, 1, true, bytes32(uint256(2)));
        basket = _open(4, 2, true, bytes32(uint256(3)));
        _approveAccount(v3);
        _approveAccount(v4);
        _approveAccount(basket);
    }

    /// @notice Measures factory deployment gas and checks that code was deployed.
    function testGasDeployFactory() external {
        vm.startSnapshotGas("GasBenchmarks", "deploy_factory");
        PositionFactory deployed = new PositionFactory();
        vm.stopSnapshotGas();
        require(address(deployed).code.length != 0, "factory deployed");
    }

    /// @notice Measures V3 gas for creating a supply-only position and checks the resulting state.
    function testGasV3CreateSupplyOnly() external {
        PositionAccount account = _open(3, 1, false, bytes32(uint256(10)));
        _record("v3_create_supply");
        require(pool.aToken().balanceOf(address(account)) == 10e18, "supplied");
        require(pool.variableDebt().balanceOf(address(account)) == 0, "no debt");
    }

    /// @notice Measures V4 gas for creating a supply-only position and checks the resulting state.
    function testGasV4CreateSupplyOnly() external {
        PositionAccount account = _open(4, 1, false, bytes32(uint256(10)));
        _record("v4_create_supply");
        require(spoke.userSupplied(address(account), 0) == 10e18, "supplied");
        require(spoke.userDebt(address(account), 2) == 0, "no debt");
    }

    /// @notice Measures V3 gas for creating a position with supply and borrowing and checks the resulting state.
    function testGasV3CreateSupplyBorrow() external {
        PositionAccount account = _open(3, 1, true, bytes32(uint256(10)));
        _record("v3_create_supply_borrow");
        require(pool.variableDebt().balanceOf(address(account)) == 2e6, "borrowed");
    }

    /// @notice Measures V4 gas for creating a position with supply and borrowing and checks the resulting state.
    function testGasV4CreateSupplyBorrow() external {
        PositionAccount account = _open(4, 1, true, bytes32(uint256(10)));
        _record("v4_create_supply_borrow");
        require(spoke.userDebt(address(account), 2) == 2e6, "borrowed");
    }

    /// @notice Measures V4 gas for creating a supply-only position with two collateral reserves and checks the resulting state.
    function testGasV4CreateTwoCollateralSupplyOnly() external {
        PositionAccount account = _open(4, 2, false, bytes32(uint256(10)));
        _record("v4_create_two_collateral_supply");
        require(spoke.userSupplied(address(account), 0) == 10e18, "first collateral");
        require(spoke.userSupplied(address(account), 1) == 5e18, "second collateral");
    }

    /// @notice Measures V4 gas for creating a two-collateral position with borrowing and checks the resulting state.
    function testGasV4CreateTwoCollateralBorrow() external {
        PositionAccount account = _open(4, 2, true, bytes32(uint256(10)));
        _record("v4_create_two_collateral_borrow");
        require(spoke.getUserAccountData(address(account)).activeCollateralCount == 2, "basket");
        require(spoke.userDebt(address(account), 2) == 2e6, "borrowed");
    }

    /// @notice Measures V3 gas for adding to the existing collateral reserve and checks the resulting state.
    function testGasV3AddCollateral() external {
        _execute(
            "v3_add_collateral",
            v3,
            _fund(address(collateral), 1e18),
            _action(ActionKind.SUPPLY, collateral, 0, 1e18, true)
        );
        require(pool.aToken().balanceOf(address(v3)) == 11e18, "supplied");
    }

    /// @notice Measures V4 gas for adding to the existing collateral reserve and checks the resulting state.
    function testGasV4AddCollateral() external {
        _execute(
            "v4_add_collateral",
            v4,
            _fund(address(collateral), 1e18),
            _action(ActionKind.SUPPLY, collateral, 0, 1e18, true)
        );
        require(spoke.userSupplied(address(v4), 0) == 11e18, "supplied");
    }

    /// @notice Measures V4 gas for adding a second collateral reserve and checks the resulting state.
    function testGasV4AddSecondCollateral() external {
        _execute(
            "v4_add_second_collateral",
            v4,
            _fund(address(secondCollateral), 1e18),
            _action(ActionKind.SUPPLY, secondCollateral, 1, 1e18, true)
        );
        require(spoke.userSupplied(address(v4), 1) == 1e18 && spoke.enabled(address(v4), 1), "second collateral");
    }

    /// @notice Measures V3 gas for withdrawing part of the supplied collateral and checks the resulting state.
    function testGasV3WithdrawPartial() external {
        _execute("v3_withdraw_partial", v3, new Funding[](0), _action(ActionKind.WITHDRAW, collateral, 0, 1e18, false));
        require(pool.aToken().balanceOf(address(v3)) == 9e18, "withdrawn");
    }

    /// @notice Measures V4 gas for withdrawing part of the supplied collateral and checks the resulting state.
    function testGasV4WithdrawPartial() external {
        _execute("v4_withdraw_partial", v4, new Funding[](0), _action(ActionKind.WITHDRAW, collateral, 0, 1e18, false));
        require(spoke.userSupplied(address(v4), 0) == 9e18, "withdrawn");
    }

    /// @notice Measures V3 gas for borrowing additional debt and checks the resulting state.
    function testGasV3BorrowMore() external {
        _execute("v3_borrow_more", v3, new Funding[](0), _action(ActionKind.BORROW, debt, 0, 1e6, false));
        require(pool.variableDebt().balanceOf(address(v3)) == 3e6, "borrowed");
    }

    /// @notice Measures V4 gas for borrowing additional debt and checks the resulting state.
    function testGasV4BorrowMore() external {
        _execute("v4_borrow_more", v4, new Funding[](0), _action(ActionKind.BORROW, debt, 2, 1e6, false));
        require(spoke.userDebt(address(v4), 2) == 3e6, "borrowed");
    }

    /// @notice Measures V3 gas for repaying part of the debt and checks the resulting state.
    function testGasV3RepayPartial() external {
        _execute("v3_repay_partial", v3, _fund(address(debt), 1e6), _action(ActionKind.REPAY, debt, 0, 1e6, false));
        require(pool.variableDebt().balanceOf(address(v3)) == 1e6, "repaid");
    }

    /// @notice Measures V4 gas for repaying part of the debt and checks the resulting state.
    function testGasV4RepayPartial() external {
        _execute("v4_repay_partial", v4, _fund(address(debt), 1e6), _action(ActionKind.REPAY, debt, 2, 1e6, false));
        require(spoke.userDebt(address(v4), 2) == 1e6, "repaid");
    }

    /// @notice Measures V3 gas for repaying all debt and refunding excess funding and checks the resulting state.
    function testGasV3RepayAll() external {
        _execute(
            "v3_repay_all", v3, _fund(address(debt), 3e6), _action(ActionKind.REPAY, debt, 0, type(uint256).max, false)
        );
        require(pool.variableDebt().balanceOf(address(v3)) == 0, "debt cleared");
        require(debt.balanceOf(address(v3)) == 0, "excess funding refunded");
    }

    /// @notice Measures V4 gas for repaying all debt and refunding excess funding and checks the resulting state.
    function testGasV4RepayAll() external {
        _execute(
            "v4_repay_all", v4, _fund(address(debt), 3e6), _action(ActionKind.REPAY, debt, 2, type(uint256).max, false)
        );
        require(spoke.userDebt(address(v4), 2) == 0, "debt cleared");
        require(debt.balanceOf(address(v4)) == 0, "excess funding refunded");
    }

    /// @notice Measures V3 gas for repaying all debt and withdrawing collateral and checks the resulting state.
    function testGasV3ClosePosition() external {
        _execute("v3_close", v3, _fund(address(debt), 2e6), _closeActions(0, false));
        require(pool.variableDebt().balanceOf(address(v3)) == 0, "debt cleared");
        require(pool.aToken().balanceOf(address(v3)) == 0, "collateral cleared");
    }

    /// @notice Measures V4 gas for repaying all debt and withdrawing collateral and checks the resulting state.
    function testGasV4ClosePosition() external {
        _execute("v4_close", v4, _fund(address(debt), 2e6), _closeActions(2, false));
        require(spoke.userDebt(address(v4), 2) == 0, "debt cleared");
        require(spoke.userSupplied(address(v4), 0) == 0, "collateral cleared");
    }

    /// @notice Measures V4 gas for repaying debt and withdrawing both collateral reserves and checks the resulting state.
    function testGasV4CloseTwoCollateralPosition() external {
        _execute("v4_close_two_collateral", basket, _fund(address(debt), 2e6), _closeActions(2, true));
        require(spoke.userDebt(address(basket), 2) == 0, "debt cleared");
        require(
            spoke.userSupplied(address(basket), 0) == 0 && spoke.userSupplied(address(basket), 1) == 0, "basket cleared"
        );
    }

    /// @notice Measures V4 gas for disabling the second collateral reserve and checks the resulting state.
    function testGasV4DisableCollateral() external {
        _execute(
            "v4_disable_collateral",
            basket,
            new Funding[](0),
            _action(ActionKind.SET_COLLATERAL, secondCollateral, 1, 0, false)
        );
        require(!spoke.enabled(address(basket), 1), "disabled");
        require(spoke.userSupplied(address(basket), 1) == 5e18, "supply retained");
    }

    /// @notice Measures V4 gas for enabling the second collateral reserve and checks the resulting state.
    function testGasV4EnableCollateral() external {
        basket.execute(new Funding[](0), _action(ActionKind.SET_COLLATERAL, secondCollateral, 1, 0, false), _limits());
        _execute(
            "v4_enable_collateral",
            basket,
            new Funding[](0),
            _action(ActionKind.SET_COLLATERAL, secondCollateral, 1, 0, true)
        );
        require(spoke.enabled(address(basket), 1), "enabled");
    }

    /// @notice Measures V4 gas for refreshing configuration and risk premium and checks the resulting state.
    function testGasV4Refresh() external {
        _execute("v4_refresh", v4, new Funding[](0), _action(ActionKind.REFRESH, collateral, 0, 0, false));
        require(spoke.userDebt(address(v4), 2) == 2e6, "debt unchanged");
        require(spoke.userSupplied(address(v4), 0) == 10e18, "collateral unchanged");
    }

    /// @notice Measures V3 gas for recovering the entire idle token balance and checks the resulting state.
    function testGasV3RecoverIdle() external {
        collateral.mint(address(v3), 1e18);
        uint256 balanceBefore = collateral.balanceOf(address(this));
        v3.recoverIdle(address(collateral), type(uint256).max);
        _record("v3_recover_idle");
        require(collateral.balanceOf(address(v3)) == 0, "idle cleared");
        require(collateral.balanceOf(address(this)) == balanceBefore + 1e18, "owner received idle");
    }

    /// @notice Measures V4 gas for recovering the entire idle token balance and checks the resulting state.
    function testGasV4RecoverIdle() external {
        collateral.mint(address(v4), 1e18);
        uint256 balanceBefore = collateral.balanceOf(address(this));
        v4.recoverIdle(address(collateral), type(uint256).max);
        _record("v4_recover_idle");
        require(collateral.balanceOf(address(v4)) == 0, "idle cleared");
        require(collateral.balanceOf(address(this)) == balanceBefore + 1e18, "owner received idle");
    }

    /// @notice Measures V3 gas for adding collateral and borrowing in one batch and checks the resulting state.
    function testGasV3AddCollateralAndBorrow() external {
        _execute("v3_add_collateral_borrow", v3, _fund(address(collateral), 1e18), _supplyBorrowActions(0));
        require(pool.aToken().balanceOf(address(v3)) == 11e18, "supplied");
        require(pool.variableDebt().balanceOf(address(v3)) == 3e6, "borrowed");
    }

    /// @notice Measures V4 gas for adding collateral and borrowing in one batch and checks the resulting state.
    function testGasV4AddCollateralAndBorrow() external {
        _execute("v4_add_collateral_borrow", v4, _fund(address(collateral), 1e18), _supplyBorrowActions(2));
        require(spoke.userSupplied(address(v4), 0) == 11e18, "supplied");
        require(spoke.userDebt(address(v4), 2) == 3e6, "borrowed");
    }

    /// @notice Creates a benchmark position with the requested collateral basket and optional borrowing.
    /// @param version Aave version, either 3 or 4.
    /// @param collateralCount Number of collateral tokens to supply, either one or two.
    /// @param borrow Whether to also borrow the fixture debt token.
    /// @param salt Owner-selected salt distinguishing positions at the same venue.
    /// @return account Newly initialized benchmark position.
    function _open(
        uint8 version,
        uint256 collateralCount,
        bool borrow,
        bytes32 salt
    ) private returns (PositionAccount account) {
        address venue = version == 3 ? address(pool) : address(spoke);
        address predicted = factory.predictPosition(address(this), version, venue, salt);
        collateral.approve(predicted, type(uint256).max);
        if (collateralCount == 2) secondCollateral.approve(predicted, type(uint256).max);
        Funding[] memory funding = new Funding[](collateralCount);
        funding[0] = Funding(address(collateral), 10e18);
        if (collateralCount == 2) funding[1] = Funding(address(secondCollateral), 5e18);
        Action[] memory actions = new Action[](collateralCount + (borrow ? 1 : 0));
        actions[0] = Action(ActionKind.SUPPLY, address(collateral), 0, 10e18, true);
        if (collateralCount == 2) actions[1] = Action(ActionKind.SUPPLY, address(secondCollateral), 1, 5e18, true);
        if (borrow) {
            actions[collateralCount] = Action(ActionKind.BORROW, address(debt), version == 3 ? 0 : 2, 2e6, false);
        }
        account = PositionAccount(factory.createPosition(version, venue, salt, funding, actions, _limits()));
    }

    /// @notice Approves the benchmark position to pull all fixture tokens.
    /// @param account Position account being queried or operated on.
    function _approveAccount(
        PositionAccount account
    ) private {
        collateral.approve(address(account), type(uint256).max);
        secondCollateral.approve(address(account), type(uint256).max);
        debt.approve(address(account), type(uint256).max);
    }

    /// @notice Executes a benchmark batch and snapshots the last external call.
    /// @param name Snapshot name within the benchmark group.
    /// @param account Position account being queried or operated on.
    /// @param funding Tokens and exact amounts to pull from the owner using prior ERC20 approvals.
    /// @param actions Ordered protocol actions to execute atomically.
    function _execute(
        string memory name,
        PositionAccount account,
        Funding[] memory funding,
        Action[] memory actions
    ) private {
        account.execute(funding, actions, _limits());
        _record(name);
    }

    /// @notice Records the last call under the GasBenchmarks snapshot group.
    /// @param name Snapshot name within the benchmark group.
    function _record(
        string memory name
    ) private {
        vm.snapshotGasLastCall("GasBenchmarks", name);
    }

    /// @notice Builds a single-token funding array.
    /// @param token Underlying ERC20 token contract.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @return funding One funding entry for the specified token and amount.
    function _fund(
        address token,
        uint256 amount
    ) private pure returns (Funding[] memory funding) {
        funding = new Funding[](1);
        funding[0] = Funding(token, amount);
    }

    /// @notice Builds a single-action array.
    /// @param kind ActionKind identifier for the requested operation.
    /// @param token Underlying ERC20 token contract.
    /// @param reserveId Spoke-local reserve identifier; V3 actions use zero.
    /// @param amount Underlying token amount in the token's smallest units.
    /// @param enabled Collateral setting used by supply and collateral-toggle actions.
    /// @return actions One typed protocol action.
    function _action(
        uint8 kind,
        TestToken token,
        uint256 reserveId,
        uint256 amount,
        bool enabled
    ) private pure returns (Action[] memory actions) {
        actions = new Action[](1);
        actions[0] = Action(kind, address(token), reserveId, amount, enabled);
    }

    /// @notice Builds full-repayment and full-withdrawal actions for a position.
    /// @param debtReserveId Debt reserve identifier: zero for V3 or two for the V4 mock.
    /// @param twoCollateral Whether to also withdraw the second collateral token.
    /// @return actions Ordered actions that repay debt before withdrawing collateral.
    function _closeActions(
        uint256 debtReserveId,
        bool twoCollateral
    ) private view returns (Action[] memory actions) {
        actions = new Action[](twoCollateral ? 3 : 2);
        actions[0] = Action(ActionKind.REPAY, address(debt), debtReserveId, type(uint256).max, false);
        actions[1] = Action(ActionKind.WITHDRAW, address(collateral), 0, type(uint256).max, false);
        if (twoCollateral) {
            actions[2] = Action(ActionKind.WITHDRAW, address(secondCollateral), 1, type(uint256).max, false);
        }
    }

    /// @notice Builds a batch that adds collateral and borrows additional debt.
    /// @param debtReserveId Debt reserve identifier: zero for V3 or two for the V4 mock.
    /// @return actions Supply of 1e18 collateral units followed by borrowing 1e6 debt units.
    function _supplyBorrowActions(
        uint256 debtReserveId
    ) private view returns (Action[] memory actions) {
        actions = new Action[](2);
        actions[0] = Action(ActionKind.SUPPLY, address(collateral), 0, 1e18, true);
        actions[1] = Action(ActionKind.BORROW, address(debt), debtReserveId, 1e6, false);
    }

    /// @notice Returns standard benchmark limits with a one-day deadline.
    /// @return Minimum health factor of 1.1e18 and maximum annualized borrow rate of 1e26.
    function _limits() private view returns (Limits memory) {
        return Limits(block.timestamp + 1 days, 1.1e18, 1e26);
    }
}
