// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PositionFixture, ReturnDataToken } from "./helpers/PositionTestSupport.sol";
import { Funding, Action, ActionKind, Limits, IERC20 } from "../src/interfaces/Types.sol";
import { IPool, ISpoke, V3ReserveData, V4Reserve, V4AccountData, IHub } from "../src/interfaces/Protocols.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { PositionFactory } from "../src/PositionFactory.sol";
import { SafeToken } from "../src/SafeToken.sol";
import { AaveV3Actions } from "../src/adapters/AaveV3Actions.sol";
import { AaveV4Actions } from "../src/adapters/AaveV4Actions.sol";

/// @notice Test-only factory that injects a prediction error while retaining the production deployment path.
contract MismatchedPredictionFactory is PositionFactory {
    /// @notice Deliberately corrupts one bit of the correct CREATE2 prediction.
    /// @param accountOwner Owner bound to the account.
    /// @param version Aave version, 3 or 4.
    /// @param venue Pool or Spoke used by the account.
    /// @param salt Owner-selected identity salt.
    /// @return Incorrect address that must be rejected during creation.
    function predictPosition(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) public view override returns (address) {
        return address(uint160(super.predictPosition(accountOwner, version, venue, salt)) ^ uint160(1));
    }

    /// @notice Exposes the unmodified production prediction to verify deployment rollback.
    /// @param accountOwner Owner bound to the account.
    /// @param version Aave version, 3 or 4.
    /// @param venue Pool or Spoke used by the account.
    /// @param salt Owner-selected identity salt.
    /// @return Correct address at which CREATE2 would deploy the account.
    function actualPosition(
        address accountOwner,
        uint8 version,
        address venue,
        bytes32 salt
    ) external view returns (address) {
        return super.predictPosition(accountOwner, version, venue, salt);
    }
}

/// @notice Exact-error and boundary tests for account, factory, token, and adapter behavior.
contract ContractEdgeCasesTest is PositionFixture {
    /// @dev Number of callback attempts that observed the exact reentrancy error.
    uint256 private reentryChecks;

    /// @notice Creates fresh positions before every test.
    function setUp() external {
        _setUp();
    }

    /// @notice Rejects unsupported versions and non-contract execution venues before deployment.
    function testFactoryRejectsInvalidIdentity() external {
        uint8[5] memory versions = [uint8(0), 1, 2, 5, 255];
        for (uint256 i; i < versions.length; ++i) {
            vm.expectRevert(PositionFactory.InvalidPlan.selector);
            factory.createPosition(versions[i], address(pool), 0, new Funding[](0), new Action[](0), _limits());
        }
        vm.expectRevert(PositionFactory.InvalidPlan.selector);
        factory.createPosition(3, address(0xBAD), 0, new Funding[](0), new Action[](0), _limits());
    }

    /// @notice A wrong prediction triggers the exact factory error and rolls back V3/V4 deployment and funding.
    function testPredictionMismatchRollsBackDeploymentAndFunding() external {
        MismatchedPredictionFactory brokenFactory = new MismatchedPredictionFactory();
        for (uint8 version = 3; version <= 4; ++version) {
            address venue = version == 3 ? address(pool) : address(spoke);
            bytes32 salt = bytes32(uint256(version));
            address actual = brokenFactory.actualPosition(address(this), version, venue, salt);
            address predicted = brokenFactory.predictPosition(address(this), version, venue, salt);
            require(actual != predicted && actual.code.length == 0 && predicted.code.length == 0, "fault configured");

            // Initialization could succeed without the guard, so an unrelated allowance error cannot mask its removal.
            collateral.approve(actual, 1e18);
            collateral.approve(predicted, 1e18);
            uint256 ownerBefore = collateral.balanceOf(address(this));
            uint256 venueBefore = collateral.balanceOf(venue);

            vm.expectRevert(abi.encodeWithSelector(PositionFactory.InvalidPlan.selector));
            brokenFactory.createPosition(
                version,
                venue,
                salt,
                _fund(address(collateral), 1e18),
                _actions(ActionKind.SUPPLY, address(collateral), 0, 1e18, true),
                _limits()
            );

            require(actual.code.length == 0 && predicted.code.length == 0, "deployment rolled back");
            require(collateral.balanceOf(address(this)) == ownerBefore, "owner funding unchanged");
            require(collateral.balanceOf(venue) == venueBefore, "venue balance unchanged");
            require(collateral.balanceOf(actual) == 0 && collateral.balanceOf(predicted) == 0, "no account funding");
            require(collateral.allowance(address(this), actual) == 1e18, "funding allowance unchanged");
            require(_supplied(version == 4, actual) == 0 && _owed(version == 4, actual) == 0, "no protocol position");
        }
    }

    /// @notice Checks account constructor validation independently of the factory guard.
    function testConstructorRejectsInvalidBindings() external {
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        new PositionAccount(address(0), 3, address(pool), 0);
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        new PositionAccount(address(this), 3, address(0xBAD), 0);
        vm.expectRevert(PositionAccount.UnsupportedVersion.selector);
        new PositionAccount(address(this), 5, address(pool), 0);
    }

    /// @notice Initialization is factory-only and may succeed only once.
    function testInitializationAuthorizationAndReplay() external {
        PositionAccount fresh = new PositionAccount(address(this), 3, address(pool), 0);
        vm.prank(address(0xBAD));
        vm.expectRevert(PositionAccount.Unauthorized.selector);
        fresh.initialize(new Funding[](0), new Action[](0), _limits());
        vm.expectRevert(PositionAccount.Unauthorized.selector);
        account3.initialize(new Funding[](0), new Action[](0), _limits());
    }

    /// @notice Rejects empty or oversized plans and oversized funding arrays.
    function testPlanSizeLimits() external {
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(new Funding[](0), new Action[](0), _limits());
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(new Funding[](0), new Action[](65), _limits());
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(
            new Funding[](33), _actions(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, true), _limits()
        );
    }

    /// @notice Accepts execution exactly at the deadline and rejects a later timestamp.
    function testDeadlineBoundary() external {
        vm.warp(100);
        Limits memory limits = Limits(100, 1e18, type(uint256).max);
        Action[] memory actions = _actions(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, true);
        account3.execute(new Funding[](0), actions, limits);
        vm.warp(101);
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(new Funding[](0), actions, limits);
    }

    /// @notice Rejects zero amounts, zero tokens, and token addresses without code.
    function testInvalidFundingEntries() external {
        Action[] memory actions = _actions(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, true);
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(_fund(address(0), 1), actions, _limits());
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(_fund(address(0xBAD), 1), actions, _limits());
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(_fund(address(collateral), 0), actions, _limits());
    }

    /// @notice Rejects funding calls that report success without delivering the exact amount.
    function testShortFundingReceiptReverts() external {
        vm.mockCall(address(collateral), abi.encodeWithSelector(IERC20.transferFrom.selector), abi.encode(true));
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account3.execute(
            _fund(address(collateral), 1e18), _actions(ActionKind.SUPPLY, address(collateral), 0, 1e18, true), _limits()
        );
        require(_supplied(false, address(account3)) == 100e18, "funding rollback");
    }

    /// @notice Supply with collateral disabled requires a valid minimum health factor.
    /// @param v4 Selects the protocol version.
    function testFuzzRiskIncreasingSupplyChecksLimits(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        vm.expectRevert(PositionAccount.InvalidLimits.selector);
        account.execute(
            _fund(address(collateral), 1),
            _actions(ActionKind.SUPPLY, address(collateral), 0, 1, false),
            Limits(type(uint256).max, 1e18 - 1, type(uint256).max)
        );
        require(_supplied(v4, address(account)) == 100e18, "supply rollback");
    }

    /// @notice Duplicate funding is refunded once per token without spending pre-existing idle funds.
    /// @param v4 Selects the protocol version.
    /// @param raw First funding amount, bounded to positive token units.
    /// @param extra Second funding amount, bounded to positive token units.
    function testFuzzDuplicateFundingRefund(
        bool v4,
        uint96 raw,
        uint96 extra
    ) external {
        PositionAccount account = _account(v4);
        uint256 firstAmount = uint256(raw) % 1e18 + 1;
        uint256 secondAmount = uint256(extra) % 1e18 + 1;
        uint256 used = firstAmount;
        collateral.mint(address(account), 9e18);
        uint256 beforeBalance = collateral.balanceOf(address(this));
        uint256 beforeSecond = second.balanceOf(address(this));
        Funding[] memory funding = new Funding[](3);
        funding[0] = Funding(address(collateral), firstAmount);
        funding[1] = Funding(address(second), 5e18);
        funding[2] = Funding(address(collateral), secondAmount);
        account.execute(funding, _actions(ActionKind.SUPPLY, address(collateral), 0, used, true), _limits());
        require(collateral.balanceOf(address(this)) == beforeBalance - used, "owner conservation");
        require(collateral.balanceOf(address(account)) == 9e18, "idle preserved");
        require(
            second.balanceOf(address(this)) == beforeSecond && second.balanceOf(address(account)) == 0,
            "unused token refunded"
        );
        require(_supplied(v4, address(account)) == 100e18 + used, "supply accounting");
    }

    /// @notice Idle recovery supports exact amounts and max, and rejects invalid callers or tokens.
    /// @param v4 Selects the protocol version.
    function testFuzzRecoveryAuthorizationAndAmounts(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        collateral.mint(address(account), 3e18);
        vm.prank(address(0xBAD));
        vm.expectRevert(PositionAccount.Unauthorized.selector);
        account.recoverIdle(address(collateral), 1);
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account.recoverIdle(address(0), 1);
        vm.expectRevert(PositionAccount.InvalidPlan.selector);
        account.recoverIdle(address(0xBAD), 1);
        uint256 beforeBalance = collateral.balanceOf(address(this));
        account.recoverIdle(address(collateral), 1e18);
        require(collateral.balanceOf(address(account)) == 2e18, "partial recovery");
        account.recoverIdle(address(collateral), type(uint256).max);
        require(collateral.balanceOf(address(account)) == 0, "full recovery");
        require(collateral.balanceOf(address(this)) == beforeBalance + 3e18, "recovery recipient");
    }

    /// @notice V3 supports both explicit collateral settings and rejects refresh and unknown actions.
    function testV3CollateralAndUnsupportedActions() external {
        account3.execute(
            new Funding[](0), _actions(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, false), _limits()
        );
        account3.execute(
            new Funding[](0), _actions(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, true), _limits()
        );
        vm.expectRevert(AaveV3Actions.InvalidAction.selector);
        account3.execute(new Funding[](0), _actions(ActionKind.REFRESH, address(collateral), 0, 0, false), _limits());
        vm.expectRevert(AaveV4Actions.InvalidAction.selector);
        account4.execute(new Funding[](0), _actions(255, address(collateral), 0, 0, false), _limits());
    }

    /// @notice Rejects invalid V3 token, reserve ID, and unlisted reserve configurations.
    function testV3InvalidReserves() external {
        vm.expectRevert(AaveV3Actions.InvalidReserve.selector);
        harness.v3(pool, Action(ActionKind.SUPPLY, address(collateral), 1, 1, true));
        vm.expectRevert(AaveV3Actions.InvalidReserve.selector);
        harness.v3(pool, Action(ActionKind.SUPPLY, address(0xBAD), 0, 1, true));
        uint8[3] memory kinds = [ActionKind.WITHDRAW, ActionKind.REPAY, ActionKind.SET_COLLATERAL];
        for (uint256 i; i < kinds.length; ++i) {
            vm.expectRevert(AaveV3Actions.InvalidReserve.selector);
            harness.v3(pool, Action(kinds[i], address(second), 0, 1, true));
        }
        vm.expectRevert(AaveV3Actions.InvalidAction.selector);
        harness.v3(pool, Action(ActionKind.BORROW, address(second), 0, 1, false));
        vm.expectRevert(AaveV3Actions.InvalidReserve.selector);
        harness.rate3(pool, address(0xBAD));
        vm.expectRevert(AaveV3Actions.InvalidReserve.selector);
        harness.rate3(pool, address(second));
    }

    /// @notice Rejects mismatched V4 token, missing Hub, and non-contract token configurations.
    function testV4InvalidReserves() external {
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.v4(spoke, Action(ActionKind.SUPPLY, address(0xBAD), 0, 1, true));
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.v4(spoke, Action(ActionKind.SUPPLY, address(second), 0, 1, true));
        V4Reserve memory reserve;
        reserve.underlying = address(collateral);
        vm.mockCall(address(spoke), abi.encodeWithSelector(ISpoke.getReserve.selector), abi.encode(reserve));
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.v4(spoke, Action(ActionKind.SUPPLY, address(collateral), 0, 1, true));
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.rate4(spoke, 0, address(collateral));
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.rate4(spoke, 0, address(0xBAD));
        vm.clearMockedCalls();
        vm.expectRevert(AaveV4Actions.InvalidReserve.selector);
        harness.rate4(spoke, 0, address(second));
    }

    /// @notice Supply rejects zero/max and borrowing rejects zero for both protocols.
    function testInvalidActionAmounts() external {
        for (uint256 i; i < 2; ++i) {
            uint256 amount = i == 0 ? 0 : type(uint256).max;
            vm.expectRevert(AaveV3Actions.InvalidAction.selector);
            harness.v3(pool, Action(ActionKind.SUPPLY, address(collateral), 0, amount, true));
            vm.expectRevert(AaveV4Actions.InvalidAction.selector);
            harness.v4(spoke, Action(ActionKind.SUPPLY, address(collateral), 0, amount, true));
        }
        vm.expectRevert(AaveV3Actions.InvalidAction.selector);
        harness.v3(pool, Action(ActionKind.BORROW, address(debt), 0, 0, false));
        vm.expectRevert(AaveV4Actions.InvalidAction.selector);
        harness.v4(spoke, Action(ActionKind.BORROW, address(debt), 2, 0, false));
    }

    /// @notice Detects venues that return normally without delivering the promised borrowed/withdrawn tokens.
    function testShortProtocolReceipts() external {
        vm.mockCall(address(pool), abi.encodeWithSelector(IPool.borrow.selector), bytes(""));
        vm.expectRevert(AaveV3Actions.AmountUnavailable.selector);
        harness.v3(pool, Action(ActionKind.BORROW, address(debt), 0, 1, false));
        vm.mockCall(address(pool), abi.encodeWithSelector(IPool.withdraw.selector), abi.encode(uint256(1)));
        vm.expectRevert(AaveV3Actions.AmountUnavailable.selector);
        harness.v3(pool, Action(ActionKind.WITHDRAW, address(collateral), 0, 1, false));
        vm.mockCall(address(spoke), abi.encodeWithSelector(ISpoke.borrow.selector), abi.encode(uint256(1), uint256(1)));
        vm.expectRevert(AaveV4Actions.AmountUnavailable.selector);
        harness.v4(spoke, Action(ActionKind.BORROW, address(debt), 2, 1, false));
    }

    /// @notice Repayment rejects zero, excess debt, and insufficient available balance.
    /// @param v4 Selects the protocol version.
    function testFuzzRepaymentBounds(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        uint256 reserve = v4 ? 2 : 0;
        bytes4 reason = v4 ? AaveV4Actions.AmountUnavailable.selector : AaveV3Actions.AmountUnavailable.selector;
        account.execute(new Funding[](0), _actions(ActionKind.BORROW, address(debt), reserve, 1e18, false), _limits());
        vm.expectRevert(reason);
        account.execute(new Funding[](0), _actions(ActionKind.REPAY, address(debt), reserve, 0, false), _limits());
        vm.expectRevert(reason);
        account.execute(new Funding[](0), _actions(ActionKind.REPAY, address(debt), reserve, 1, false), _limits());
        vm.expectRevert(reason);
        account.execute(
            _fund(address(debt), 1e18), _actions(ActionKind.REPAY, address(debt), reserve, 1e18 + 1, false), _limits()
        );
        require(_owed(v4, address(account)) == 1e18, "repayment rollback");
    }

    /// @notice A borrow rate exactly at the cap succeeds and a cap one ray lower rolls the batch back.
    /// @param v4 Selects the protocol version.
    function testFuzzBorrowRateBoundary(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        uint256 reserve = v4 ? 2 : 0;
        uint256 rate = v4 ? 525e23 : 5e25;
        account.execute(
            new Funding[](0),
            _actions(ActionKind.BORROW, address(debt), reserve, 1e18, false),
            Limits(type(uint256).max, 1.5e18, rate)
        );
        vm.expectRevert(abi.encodeWithSelector(PositionAccount.BorrowRateExceeded.selector, rate, rate - 1));
        account.execute(
            new Funding[](0),
            _actions(ActionKind.BORROW, address(debt), reserve, 1e18, false),
            Limits(type(uint256).max, 1.5e18, rate - 1)
        );
        require(_owed(v4, address(account)) == 1e18, "rate rollback");
    }

    /// @notice Empty and true token responses succeed, while false, short, long, and reverting calls fail.
    function testTokenReturnDataVariants() external {
        for (uint256 i; i < 6; ++i) {
            ReturnDataToken token = new ReturnDataToken(i);
            if (i >= 2) vm.expectRevert(abi.encodeWithSelector(SafeToken.TokenCallFailed.selector, address(token)));
            harness.tokenCall(address(token), hex"12345678");
        }
        vm.expectRevert(abi.encodeWithSelector(SafeToken.TokenCallFailed.selector, address(0xBAD)));
        harness.tokenCall(address(0xBAD), hex"12345678");
        ReturnDataToken invalidBool = new ReturnDataToken(6);
        (bool ok,) = address(harness).call(abi.encodeCall(harness.tokenCall, (address(invalidBool), hex"12345678")));
        require(!ok, "invalid bool accepted");
    }

    /// @notice V4 premium math rounds fractional ray adjustments upward.
    /// @param baseRate Arbitrary bounded base rate in ray units.
    /// @param premium Arbitrary basis-point premium.
    function testFuzzV4RateRounding(
        uint128 baseRate,
        uint24 premium
    ) external {
        V4AccountData memory data;
        data.riskPremium = premium;
        vm.mockCall(address(spoke), abi.encodeWithSelector(ISpoke.getUserAccountData.selector), abi.encode(data));
        vm.mockCall(
            address(spoke.hub()), abi.encodeWithSelector(IHub.getAssetDrawnRate.selector), abi.encode(uint256(baseRate))
        );
        uint256 rate = harness.rate4(spoke, 0, address(collateral));
        uint256 product = uint256(baseRate) * premium;
        uint256 premiumRate = product / 10_000 + (product % 10_000 == 0 ? 0 : 1);
        require(rate == uint256(baseRate) + premiumRate, "premium rounding");
    }

    /// @notice All three locked entry points reject callbacks during execution and idle recovery.
    /// @param v4 Selects the protocol version.
    function testFuzzReentryAcrossLockedEntrypoints(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        for (uint8 entry; entry < 3; ++entry) {
            collateral.setCallback(address(this), abi.encodeCall(this.checkReentry, (account, entry)));
            account.execute(
                _fund(address(collateral), 1), _actions(ActionKind.SUPPLY, address(collateral), 0, 1, true), _limits()
            );
            require(reentryChecks == uint256(entry + 1) * 2, "execution callbacks");
        }
        collateral.mint(address(account), 1);
        collateral.setCallback(address(this), abi.encodeCall(this.checkReentry, (account, uint8(2))));
        account.recoverIdle(address(collateral), 1);
        require(reentryChecks == 7, "recovery callback");
    }

    /// @notice Asserts the exact guard error and allows the legitimate outer operation to continue.
    /// @param account Account currently executing the token callback.
    /// @param entry Zero: execute; one: initialize; two: recoverIdle.
    function checkReentry(
        PositionAccount account,
        uint8 entry
    ) external {
        bytes memory data;
        if (entry == 0) {
            data = abi.encodeCall(PositionAccount.execute, (new Funding[](0), new Action[](0), _limits()));
        } else if (entry == 1) {
            data = abi.encodeCall(PositionAccount.initialize, (new Funding[](0), new Action[](0), _limits()));
        } else {
            data = abi.encodeCall(PositionAccount.recoverIdle, (address(collateral), uint256(0)));
        }
        (bool ok, bytes memory reason) = address(account).call(data);
        require(
            !ok && keccak256(reason) == keccak256(abi.encodeWithSelector(PositionAccount.Reentered.selector)),
            "exact locked-entry error"
        );
        ++reentryChecks;
    }

    /// @notice Zero-amount withdrawals return without transferring tokens in either adapter.
    /// @param v4 Selects the protocol version.
    function testFuzzZeroWithdrawal(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        uint256 beforeBalance = collateral.balanceOf(address(this));
        account.execute(new Funding[](0), _actions(ActionKind.WITHDRAW, address(collateral), 0, 0, false), _limits());
        require(_supplied(v4, address(account)) == 100e18, "zero withdrawal supply");
        require(collateral.balanceOf(address(this)) == beforeBalance, "zero withdrawal owner");
    }
}
