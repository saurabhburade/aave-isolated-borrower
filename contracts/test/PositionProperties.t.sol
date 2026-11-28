// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PositionFixture } from "./helpers/PositionTestSupport.sol";
import { Funding, Action, ActionKind, Limits } from "../src/interfaces/Types.sol";
import { PositionAccount } from "../src/PositionAccount.sol";

/// @notice Input-fuzzed lifecycle, deployment, rollback, and boundary properties.
contract PositionPropertiesTest is PositionFixture {
    /// @notice Builds fresh V3 and V4 accounts before each fuzz case.
    function setUp() external {
        _setUp();
    }

    /// @notice Supply, borrow, repayment, refunds, and full withdrawal conserve underlying tokens.
    /// @param v4 Selects the protocol version.
    /// @param rawSupply Additional collateral, bounded to positive units below 1e18.
    /// @param rawBorrow Borrow size, bounded below half the additional collateral.
    /// @param rawExtra Excess repayment funding, bounded below 1e18.
    /// @param repayMax Whether to use the full-debt sentinel or the explicit debt amount.
    function testFuzzLifecycleConservesTokens(
        bool v4,
        uint96 rawSupply,
        uint96 rawBorrow,
        uint96 rawExtra,
        bool repayMax
    ) external {
        PositionAccount account = _account(v4);
        uint256 supplied = uint256(rawSupply) % 1e18 + 2;
        uint256 borrowed = uint256(rawBorrow) % (supplied / 2) + 1;
        uint256 extra = uint256(rawExtra) % 1e18;
        debt.mint(address(this), extra);
        uint256 collateralBefore = collateral.balanceOf(address(this));
        account.execute(
            _fund(address(collateral), supplied),
            _actions(ActionKind.SUPPLY, address(collateral), 0, supplied, true),
            _limits()
        );
        account.execute(
            new Funding[](0), _actions(ActionKind.BORROW, address(debt), v4 ? 2 : 0, borrowed, false), _limits()
        );
        require(debt.balanceOf(address(this)) == borrowed + extra, "borrow recipient");
        Action[] memory close = new Action[](2);
        close[0] = Action(ActionKind.REPAY, address(debt), v4 ? 2 : 0, repayMax ? type(uint256).max : borrowed, false);
        close[1] = Action(ActionKind.WITHDRAW, address(collateral), 0, type(uint256).max, false);
        account.execute(_fund(address(debt), borrowed + extra), close, _limits());
        require(_owed(v4, address(account)) == 0 && _supplied(v4, address(account)) == 0, "position closed");
        require(collateral.balanceOf(address(this)) == collateralBefore + 100e18, "collateral returned");
        require(debt.balanceOf(address(this)) == extra, "excess refunded");
        require(collateral.balanceOf(address(account)) == 0 && debt.balanceOf(address(account)) == 0, "no idle dust");
        address venue = account.venue();
        require(
            collateral.allowance(address(account), venue) == 0 && debt.allowance(address(account), venue) == 0,
            "approvals cleared"
        );
        require(_supplied(!v4, address(_account(!v4))) == 100e18, "other account isolated");
    }

    /// @notice CREATE2 prediction agrees with deployment and binds all immutable identity fields.
    /// @param rawOwner Random owner; zero is replaced with a nonzero test address.
    /// @param salt Arbitrary owner-selected salt.
    /// @param v4 Selects the protocol version and corresponding venue.
    function testFuzzPredictionAndIdentity(
        address rawOwner,
        bytes32 salt,
        bool v4
    ) external {
        address owner = rawOwner == address(0) ? address(1) : rawOwner;
        uint8 version = v4 ? 4 : 3;
        address venue = v4 ? address(spoke) : address(pool);
        address predicted = factory.predictPosition(owner, version, venue, salt);
        collateral.mint(owner, 1e18);
        vm.prank(owner);
        collateral.approve(predicted, 1e18);
        vm.prank(owner);
        address deployed = factory.createPosition(
            version,
            venue,
            salt,
            _fund(address(collateral), 1e18),
            _actions(ActionKind.SUPPLY, address(collateral), 0, 1e18, true),
            _limits()
        );
        PositionAccount account = PositionAccount(deployed);
        require(deployed == predicted, "prediction");
        require(account.owner() == owner && account.version() == version && account.venue() == venue, "bindings");
        require(
            account.salt() == salt && account.chainId() == block.chainid && account.factory() == address(factory),
            "identity"
        );
    }

    /// @notice A final rate failure undoes earlier supply, funding, debt, and owner transfers.
    /// @param v4 Selects the protocol version.
    /// @param rawSupply Random positive additional supply below 1e18.
    function testFuzzFailedBatchIsAtomic(
        bool v4,
        uint96 rawSupply
    ) external {
        PositionAccount account = _account(v4);
        uint256 supplied = uint256(rawSupply) % 1e18 + 1;
        uint256 beforeBalance = collateral.balanceOf(address(this));
        Action[] memory actions = new Action[](2);
        actions[0] = Action(ActionKind.SUPPLY, address(collateral), 0, supplied, true);
        actions[1] = Action(ActionKind.BORROW, address(debt), v4 ? 2 : 0, 1e18, false);
        uint256 rate = v4 ? 525e23 : 5e25;
        vm.expectRevert(abi.encodeWithSelector(PositionAccount.BorrowRateExceeded.selector, rate, uint256(0)));
        account.execute(_fund(address(collateral), supplied), actions, Limits(type(uint256).max, 1e18, 0));
        require(
            collateral.balanceOf(address(this)) == beforeBalance && debt.balanceOf(address(this)) == 0, "owner rollback"
        );
        require(_supplied(v4, address(account)) == 100e18 && _owed(v4, address(account)) == 0, "position rollback");
        require(collateral.balanceOf(address(account)) == 0 && debt.balanceOf(address(account)) == 0, "idle rollback");
        require(collateral.allowance(address(account), account.venue()) == 0, "approval rollback");
    }

    /// @notice A final health factor equal to the floor succeeds; one unit above actual health reverts.
    /// @param v4 Selects the protocol version.
    function testFuzzHealthFactorBoundary(
        bool v4
    ) external {
        PositionAccount account = _account(v4);
        Action[] memory borrow = _actions(ActionKind.BORROW, address(debt), v4 ? 2 : 0, 1e18, false);
        account.execute(new Funding[](0), borrow, Limits(type(uint256).max, 200e18, type(uint256).max));
        vm.expectRevert(
            abi.encodeWithSelector(PositionAccount.Unhealthy.selector, uint256(100e18), uint256(100e18 + 1))
        );
        account.execute(new Funding[](0), borrow, Limits(type(uint256).max, 100e18 + 1, type(uint256).max));
        require(_owed(v4, address(account)) == 1e18, "health rollback");
    }

    /// @notice The maximum permitted action and funding counts execute successfully.
    function testMaximumPlanSizesAreAccepted() external {
        Funding[] memory funding = new Funding[](32);
        for (uint256 i; i < funding.length; ++i) {
            funding[i] = Funding(address(collateral), 1);
        }
        Action[] memory actions = new Action[](64);
        actions[0] = Action(ActionKind.SUPPLY, address(collateral), 0, 1, true);
        for (uint256 i = 1; i < actions.length; ++i) {
            actions[i] = Action(ActionKind.SET_COLLATERAL, address(collateral), 0, 0, true);
        }
        uint256 beforeBalance = collateral.balanceOf(address(this));
        account3.execute(funding, actions, _limits());
        require(collateral.balanceOf(address(this)) == beforeBalance - 1, "refund all unused duplicates");
        require(_supplied(false, address(account3)) == 100e18 + 1, "maximum plan supply");
    }
}
