// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "../../src/interfaces/Types.sol";
import { IPool, ISpoke } from "../../src/interfaces/Protocols.sol";
import { PositionAccount } from "../../src/PositionAccount.sol";
import { PositionFactory } from "../../src/PositionFactory.sol";
import { AaveV3Actions } from "../../src/adapters/AaveV3Actions.sol";
import { AaveV4Actions } from "../../src/adapters/AaveV4Actions.sol";
import { SafeToken } from "../../src/SafeToken.sol";
import { TestToken, MockV3Pool, MockV4Spoke } from "../PositionAccount.t.sol";

/// @notice Foundry controls used by the contract behavior and property suites.
interface PropertyVm {
    /// @notice Expects the next external call to revert with an exact payload.
    /// @param reason Expected ABI-encoded revert data.
    function expectRevert(
        bytes calldata reason
    ) external;
    /// @notice Expects the next external call to revert with the given selector.
    /// @param reason Expected error selector.
    function expectRevert(
        bytes4 reason
    ) external;
    /// @notice Changes the sender of the next external call.
    /// @param sender Address to impersonate.
    function prank(
        address sender
    ) external;
    /// @notice Overrides matching external calls without changing target storage.
    /// @param target Contract whose calls are intercepted.
    /// @param data Calldata prefix to match.
    /// @param result ABI-encoded return data.
    function mockCall(
        address target,
        bytes calldata data,
        bytes calldata result
    ) external;
    /// @notice Removes all mocked external-call responses.
    function clearMockedCalls() external;
    /// @notice Changes the block timestamp.
    /// @param timestamp New timestamp in seconds.
    function warp(
        uint256 timestamp
    ) external;
}

/// @notice Exposes internal libraries without altering production contracts.
contract AdapterHarness {
    /// @notice Executes a V3 action in this harness account.
    /// @param pool V3 venue.
    /// @param action Requested operation.
    /// @return actual Underlying amount moved.
    /// @return risk Whether the operation increases risk.
    function v3(
        IPool pool,
        Action calldata action
    ) external returns (uint256 actual, bool risk) {
        return AaveV3Actions.execute(pool, action, msg.sender);
    }

    /// @notice Executes a V4 action in this harness account.
    /// @param spoke V4 venue.
    /// @param action Requested operation.
    /// @return actual Underlying amount moved.
    /// @return risk Whether the operation increases risk.
    function v4(
        ISpoke spoke,
        Action calldata action
    ) external returns (uint256 actual, bool risk) {
        return AaveV4Actions.execute(spoke, action, msg.sender);
    }

    /// @notice Reads the V3 variable borrow rate.
    /// @param pool V3 venue.
    /// @param token Underlying asset.
    /// @return Annualized rate in ray units.
    function rate3(
        IPool pool,
        address token
    ) external view returns (uint256) {
        return AaveV3Actions.borrowRate(pool, token);
    }

    /// @notice Reads the V4 rate including this harness risk premium.
    /// @param spoke V4 venue.
    /// @param reserve Spoke reserve identifier.
    /// @param token Expected underlying asset.
    /// @return Annualized rate in ray units.
    function rate4(
        ISpoke spoke,
        uint256 reserve,
        address token
    ) external view returns (uint256) {
        return AaveV4Actions.borrowRate(spoke, reserve, token, address(this));
    }

    /// @notice Performs a validated low-level ERC20 call.
    /// @param token Target token.
    /// @param data ABI-encoded token call.
    /// @return Raw successful return data.
    function tokenCall(
        address token,
        bytes calldata data
    ) external returns (bytes memory) {
        return SafeToken.invoke(token, data);
    }
}

/// @notice Token-call response generator for empty, false, malformed, and reverting responses.
contract ReturnDataToken {
    /// @dev Response mode selected at construction.
    uint256 private immutable mode;

    /// @notice Selects the response returned for any calldata.
    /// @param responseMode Zero: empty; one: true; two: false; three: short; four: long; five: revert; six: invalid bool.
    constructor(
        uint256 responseMode
    ) {
        mode = responseMode;
    }

    /// @notice Returns deliberately varied ERC20-compatible or malformed data.
    fallback() external {
        uint256 selected = mode;
        assembly {
            if eq(selected, 0) { return(0, 0) }
            if eq(selected, 5) { revert(0, 0) }
            mstore(0, 1)
            if eq(selected, 2) { mstore(0, 0) }
            if eq(selected, 3) { return(0, 1) }
            if eq(selected, 4) { return(0, 64) }
            if eq(selected, 6) { mstore(0, 2) }
            return(0, 32)
        }
    }
}

/// @notice Shared deterministic fixture with equal token decimals and ample venue liquidity.
abstract contract PositionFixture {
    /// @dev Foundry cheatcode endpoint.
    PropertyVm internal constant vm = PropertyVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @dev Factory under test.
    PositionFactory internal factory;
    /// @dev Primary collateral token.
    TestToken internal collateral;
    /// @dev Second collateral and unsupported V3 reserve token.
    TestToken internal second;
    /// @dev Debt token; equal decimals make the mock health-factor arithmetic comparable.
    TestToken internal debt;
    /// @dev Deterministic V3 venue.
    MockV3Pool internal pool;
    /// @dev Deterministic V4 venue.
    MockV4Spoke internal spoke;
    /// @dev Initialized V3 account owned by this fixture.
    PositionAccount internal account3;
    /// @dev Initialized V4 account owned by this fixture.
    PositionAccount internal account4;
    /// @dev Internal-library entry points.
    AdapterHarness internal harness;

    /// @notice Creates the tokens, venues, and two accounts with 100 collateral units each.
    function _setUp() internal {
        factory = new PositionFactory();
        collateral = new TestToken("Collateral", 18);
        second = new TestToken("Second", 18);
        debt = new TestToken("Debt", 18);
        pool = new MockV3Pool(collateral, debt);
        spoke = new MockV4Spoke(collateral, second, debt);
        harness = new AdapterHarness();
        collateral.mint(address(this), 1e24);
        second.mint(address(this), 1e24);
        pool.mintLiquidity(1e24);
        spoke.mintLiquidity(1e24);
        account3 = _newAccount(3, bytes32(uint256(1)));
        account4 = _newAccount(4, bytes32(uint256(2)));
    }

    /// @notice Deploys and initializes a directly owned account with seed collateral.
    /// @param version Aave version, 3 or 4.
    /// @param salt Identity salt recorded by the account.
    /// @return account Initialized position account.
    function _newAccount(
        uint8 version,
        bytes32 salt
    ) internal returns (PositionAccount account) {
        account = new PositionAccount(address(this), version, version == 3 ? address(pool) : address(spoke), salt);
        collateral.approve(address(account), type(uint256).max);
        second.approve(address(account), type(uint256).max);
        debt.approve(address(account), type(uint256).max);
        account.initialize(
            _fund(address(collateral), 100e18),
            _actions(ActionKind.SUPPLY, address(collateral), 0, 100e18, true),
            _limits()
        );
    }

    /// @notice Constructs permissive test limits with a meaningful health-factor floor.
    /// @return Limits with a 1.5 health factor and no effective rate or deadline cap.
    function _limits() internal pure returns (Limits memory) {
        return Limits(type(uint256).max, 1.5e18, type(uint256).max);
    }

    /// @notice Constructs one funding entry.
    /// @param token Funding token.
    /// @param amount Amount in smallest token units.
    /// @return funding Single-token funding array.
    function _fund(
        address token,
        uint256 amount
    ) internal pure returns (Funding[] memory funding) {
        funding = new Funding[](1);
        funding[0] = Funding(token, amount);
    }

    /// @notice Constructs one action.
    /// @param kind ActionKind identifier.
    /// @param token Underlying token.
    /// @param reserve Spoke-local reserve identifier or zero for V3.
    /// @param amount Amount in smallest token units.
    /// @param enabled Collateral preference.
    /// @return actions Single-action array.
    function _actions(
        uint8 kind,
        address token,
        uint256 reserve,
        uint256 amount,
        bool enabled
    ) internal pure returns (Action[] memory actions) {
        actions = new Action[](1);
        actions[0] = Action(kind, token, reserve, amount, enabled);
    }

    /// @notice Returns the fixture account for a protocol version.
    /// @param v4 Whether to use V4.
    /// @return Selected initialized account.
    function _account(
        bool v4
    ) internal view returns (PositionAccount) {
        return v4 ? account4 : account3;
    }

    /// @notice Reads a fixture account supply balance from the mock venue.
    /// @param v4 Whether to use V4.
    /// @param account Position being queried.
    /// @return Supplied collateral token units.
    function _supplied(
        bool v4,
        address account
    ) internal view returns (uint256) {
        return v4 ? spoke.userSupplied(account, 0) : pool.aToken().balanceOf(account);
    }

    /// @notice Reads a fixture account debt balance from the mock venue.
    /// @param v4 Whether to use V4.
    /// @param account Position being queried.
    /// @return Outstanding debt token units.
    function _owed(
        bool v4,
        address account
    ) internal view returns (uint256) {
        return v4 ? spoke.userDebt(account, 2) : pool.variableDebt().balanceOf(account);
    }
}
