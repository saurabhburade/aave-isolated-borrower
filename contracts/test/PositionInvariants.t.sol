// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PositionFixture } from "./helpers/PositionTestSupport.sol";
import { Funding, Action, ActionKind } from "../src/interfaces/Types.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { AaveV3Actions } from "../src/adapters/AaveV3Actions.sol";
import { AaveV4Actions } from "../src/adapters/AaveV4Actions.sol";

/// @notice Owns four real position wrappers and maintains an independent model across randomized actions.
/// @dev Protocol mocks deliberately omit live interest and oracle pricing. These properties test wrapper accounting.
contract PositionHandler is PositionFixture {
    /// @notice Two V3 and two V4 accounts; odd indices select V4.
    PositionAccount[4] public accounts;
    /// @notice Expected primary collateral amounts indexed by account.
    uint256[4] public suppliedModel;
    /// @notice Expected second collateral amounts for the V4 accounts.
    uint256[4] public secondModel;
    /// @notice Expected debt amounts indexed by account.
    uint256[4] public debtModel;
    /// @notice Expected unsolicited idle collateral, preserved until explicit recovery.
    uint256[4] public idleModel;

    /// @notice Builds isolated accounts, liquidity, and independent starting balances.
    constructor() {
        _setUp();
        accounts[0] = account3;
        accounts[1] = account4;
        accounts[2] = _newAccount(3, bytes32(uint256(3)));
        accounts[3] = _newAccount(4, bytes32(uint256(4)));
        for (uint256 i; i < 4; ++i) {
            suppliedModel[i] = 100e18;
            if (i % 2 == 1) {
                accounts[i].execute(
                    _fund(address(second), 50e18),
                    _actions(ActionKind.SUPPLY, address(second), 1, 50e18, true),
                    _limits()
                );
                secondModel[i] = 50e18;
            }
        }
    }

    /// @notice Supplies randomized collateral with duplicate funding and an unused surplus.
    /// @param seed Account selector.
    /// @param rawAmount Amount bounded to 1 through 1e18 token units.
    /// @param useSecond Whether to use secondary collateral for a V4 account.
    function supply(
        uint256 seed,
        uint96 rawAmount,
        bool useSecond
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        bool secondary = index % 2 == 1 && useSecond;
        address token = secondary ? address(second) : address(collateral);
        uint256 amount = uint256(rawAmount) % 1e18 + 1;
        Funding[] memory funding = new Funding[](2);
        funding[0] = Funding(token, amount);
        funding[1] = Funding(token, 7);
        accounts[index].execute(funding, _actions(ActionKind.SUPPLY, token, secondary ? 1 : 0, amount, true), _limits());
        if (secondary) secondModel[index] += amount;
        else suppliedModel[index] += amount;
        require(others == _otherPositions(index), "supply isolation");
    }

    /// @notice Borrows within a conservative independently computed collateral bound.
    /// @param seed Account selector.
    /// @param rawAmount Borrow amount bounded by available safe headroom.
    function borrow(
        uint256 seed,
        uint96 rawAmount
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        uint256 room = suppliedModel[index] / 2 - debtModel[index];
        if (room == 0) return;
        uint256 amount = uint256(rawAmount) % room + 1;
        accounts[index].execute(
            new Funding[](0),
            _actions(ActionKind.BORROW, address(debt), index % 2 == 1 ? 2 : 0, amount, false),
            _limits()
        );
        debtModel[index] += amount;
        require(others == _otherPositions(index), "borrow isolation");
    }

    /// @notice Repays partial or full debt with excess funding that must be refunded.
    /// @param seed Account selector.
    /// @param rawAmount Repayment amount bounded by current modeled debt.
    /// @param full Whether to use the full-debt sentinel.
    function repay(
        uint256 seed,
        uint96 rawAmount,
        bool full
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        uint256 owed = debtModel[index];
        if (owed == 0) return;
        uint256 amount = full ? owed : uint256(rawAmount) % owed + 1;
        // Extra funding comes from already borrowed tokens, so the total token supply remains fixed.
        uint256 available = debt.balanceOf(address(this));
        uint256 extra = available > amount ? (available - amount > 13 ? 13 : available - amount) : 0;
        accounts[index].execute(
            _fund(address(debt), amount + extra),
            _actions(ActionKind.REPAY, address(debt), index % 2 == 1 ? 2 : 0, full ? type(uint256).max : amount, false),
            _limits()
        );
        debtModel[index] -= amount;
        require(others == _otherPositions(index), "repay isolation");
    }

    /// @notice Withdraws modeled collateral while retaining independently computed debt backing.
    /// @param seed Account selector.
    /// @param rawAmount Withdrawal amount bounded by safely removable collateral.
    /// @param useSecond Whether to withdraw V4 secondary collateral.
    function withdraw(
        uint256 seed,
        uint96 rawAmount,
        bool useSecond
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        bool secondary = index % 2 == 1 && useSecond;
        uint256 removable = secondary ? secondModel[index] : suppliedModel[index] - debtModel[index] * 2;
        if (removable == 0) return;
        uint256 amount = uint256(rawAmount) % removable + 1;
        accounts[index].execute(
            new Funding[](0),
            _actions(
                ActionKind.WITHDRAW, secondary ? address(second) : address(collateral), secondary ? 1 : 0, amount, false
            ),
            _limits()
        );
        if (secondary) secondModel[index] -= amount;
        else suppliedModel[index] -= amount;
        require(others == _otherPositions(index), "withdraw isolation");
    }

    /// @notice Transfers unsolicited collateral into an account, separately from execution funding.
    /// @param seed Account selector.
    /// @param rawAmount Donation amount bounded below 1e18.
    function donate(
        uint256 seed,
        uint96 rawAmount
    ) external {
        uint256 index = seed % 4;
        uint256 amount = uint256(rawAmount) % 1e18 + 1;
        require(collateral.transfer(address(accounts[index]), amount), "donation transfer");
        idleModel[index] += amount;
    }

    /// @notice Recovers all unsolicited idle collateral without changing any protocol position.
    /// @param seed Account selector.
    function recover(
        uint256 seed
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        accounts[index].recoverIdle(address(collateral), type(uint256).max);
        idleModel[index] = 0;
        require(others == _otherPositions(index), "recovery isolation");
    }

    /// @notice Toggles V4 secondary collateral or refreshes configuration while primary backing remains safe.
    /// @param seed Account selector.
    /// @param enabled Requested secondary collateral setting.
    /// @param refresh Whether to refresh V4 configuration instead of changing collateral status.
    function configure(
        uint256 seed,
        bool enabled,
        bool refresh
    ) external {
        uint256 index = seed % 4;
        bytes32 others = _otherPositions(index);
        bool v4 = index % 2 == 1;
        uint8 kind = v4 && refresh ? ActionKind.REFRESH : ActionKind.SET_COLLATERAL;
        accounts[index].execute(
            new Funding[](0),
            _actions(kind, v4 ? address(second) : address(collateral), v4 ? 1 : 0, 0, v4 ? enabled : true),
            _limits()
        );
        require(others == _otherPositions(index), "configuration isolation");
    }

    /// @notice Failed post-supply actions must restore all balances, positions, and allowances.
    /// @param seed Account selector.
    /// @param rawAmount Amount briefly supplied before a deliberately unsupported action.
    function failedBatch(
        uint256 seed,
        uint96 rawAmount
    ) external {
        uint256 index = seed % 4;
        bytes32 beforeState = _allState();
        uint256 amount = uint256(rawAmount) % 1e18 + 1;
        Action[] memory actions = new Action[](2);
        actions[0] = Action(ActionKind.SUPPLY, address(collateral), 0, amount, true);
        actions[1] = Action(255, address(collateral), 0, 0, false);
        (bool ok, bytes memory reason) = address(accounts[index])
            .call(abi.encodeCall(PositionAccount.execute, (_fund(address(collateral), amount), actions, _limits())));
        bytes4 expected = index % 2 == 1 ? AaveV4Actions.InvalidAction.selector : AaveV3Actions.InvalidAction.selector;
        require(!ok && keccak256(reason) == keccak256(abi.encodeWithSelector(expected)), "exact failed action");
        require(beforeState == _allState(), "atomic rollback");
    }

    /// @notice Unauthorized execution/recovery and repeated initialization must fail without changing state.
    /// @param seed Account selector.
    function unauthorized(
        uint256 seed
    ) external {
        PositionAccount account = accounts[seed % 4];
        bytes32 beforeState = _allState();
        vm.prank(address(0xBAD));
        (bool ok, bytes memory reason) = address(account)
            .call(abi.encodeCall(PositionAccount.execute, (new Funding[](0), new Action[](0), _limits())));
        require(
            !ok && keccak256(reason) == keccak256(abi.encodeWithSelector(PositionAccount.Unauthorized.selector)),
            "execute authorization"
        );
        vm.prank(address(0xBAD));
        (ok, reason) = address(account)
            .call(abi.encodeCall(PositionAccount.recoverIdle, (address(collateral), type(uint256).max)));
        require(
            !ok && keccak256(reason) == keccak256(abi.encodeWithSelector(PositionAccount.Unauthorized.selector)),
            "recovery authorization"
        );
        (ok, reason) = address(account)
            .call(abi.encodeCall(PositionAccount.initialize, (new Funding[](0), new Action[](0), _limits())));
        require(
            !ok && keccak256(reason) == keccak256(abi.encodeWithSelector(PositionAccount.Unauthorized.selector)),
            "initialize replay"
        );
        require(beforeState == _allState(), "unauthorized state change");
    }

    /// @notice Checks the independent model, idle preservation, immutable bindings, and zero venue approvals.
    function assertPositions() external view {
        for (uint256 i; i < 4; ++i) {
            PositionAccount account = accounts[i];
            bool v4 = i % 2 == 1;
            require(_supplied(v4, address(account)) == suppliedModel[i], "supply model");
            require(_owed(v4, address(account)) == debtModel[i], "debt model");
            if (v4) require(spoke.userSupplied(address(account), 1) == secondModel[i], "secondary model");
            require(collateral.balanceOf(address(account)) == idleModel[i], "unsolicited idle preserved");
            require(
                debt.balanceOf(address(account)) == 0 && second.balanceOf(address(account)) == 0, "funding refunded"
            );
            require(account.owner() == address(this) && account.factory() == address(this), "immutable authority");
            require(
                account.version() == (v4 ? 4 : 3) && account.venue() == (v4 ? address(spoke) : address(pool)),
                "immutable venue"
            );
            require(collateral.allowance(address(account), account.venue()) == 0, "collateral approval");
            require(second.allowance(address(account), account.venue()) == 0, "secondary approval");
            require(debt.allowance(address(account), account.venue()) == 0, "debt approval");
            require(debtModel[i] <= suppliedModel[i] / 2, "independent solvency bound");
        }
    }

    /// @notice Checks underlying token conservation across owner, venues, and all position accounts.
    function assertConservation() external view {
        uint256 c = collateral.balanceOf(address(this)) + collateral.balanceOf(address(pool))
            + collateral.balanceOf(address(spoke));
        uint256 d = debt.balanceOf(address(this)) + debt.balanceOf(address(pool)) + debt.balanceOf(address(spoke));
        uint256 s = second.balanceOf(address(this)) + second.balanceOf(address(pool)) + second.balanceOf(address(spoke));
        for (uint256 i; i < 4; ++i) {
            c += collateral.balanceOf(address(accounts[i]));
            d += debt.balanceOf(address(accounts[i]));
            s += second.balanceOf(address(accounts[i]));
        }
        require(c == 1e24 && d == 2e24 && s == 1e24, "underlying conservation");
    }

    /// @notice Hashes every account except the one an action is allowed to modify.
    /// @param excluded Index of the account allowed to change; four includes every account.
    /// @return Combined position, idle-balance, configuration, and approval fingerprint.
    function _otherPositions(
        uint256 excluded
    ) private view returns (bytes32) {
        bytes32 result;
        for (uint256 i; i < 4; ++i) {
            if (i == excluded) continue;
            address account = address(accounts[i]);
            bool v4 = i % 2 == 1;
            result = keccak256(
                abi.encode(
                    result,
                    _supplied(v4, account),
                    _owed(v4, account),
                    collateral.balanceOf(account),
                    debt.balanceOf(account),
                    second.balanceOf(account)
                )
            );
            if (v4) {
                result = keccak256(
                    abi.encode(
                        result, spoke.userSupplied(account, 1), spoke.enabled(account, 0), spoke.enabled(account, 1)
                    )
                );
            }
            address venue = accounts[i].venue();
            result = keccak256(
                abi.encode(
                    result,
                    collateral.allowance(account, venue),
                    debt.allowance(account, venue),
                    second.allowance(account, venue)
                )
            );
        }
        return result;
    }

    /// @notice Hashes owner and venue token balances together with all positions.
    /// @return Complete fingerprint used to assert failed-call atomicity.
    function _allState() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                _otherPositions(4),
                collateral.balanceOf(address(this)),
                debt.balanceOf(address(this)),
                second.balanceOf(address(this)),
                collateral.balanceOf(address(pool)),
                collateral.balanceOf(address(spoke)),
                debt.balanceOf(address(pool)),
                debt.balanceOf(address(spoke)),
                second.balanceOf(address(spoke))
            )
        );
    }
}

/// @notice Runs real stateful Foundry invariant sequences against the explicitly selected handler actions.
contract PositionInvariantsTest {
    /// @notice Foundry selector-target configuration ABI, matching forge-std StdInvariant.
    struct FuzzSelector {
        /// @dev Contract whose selected functions are randomized.
        address addr;
        /// @dev Function selectors eligible for randomized calls.
        bytes4[] selectors;
    }

    /// @notice Optional Foundry artifact selector configuration, unused by this suite.
    struct FuzzArtifactSelector {
        /// @dev Artifact name whose selectors would be targeted.
        string artifact;
        /// @dev Eligible function selectors.
        bytes4[] selectors;
    }

    /// @notice Optional Foundry interface configuration, unused by this suite.
    struct FuzzInterface {
        /// @dev Contract whose artifact interfaces would be targeted.
        address addr;
        /// @dev Artifact names providing callable interfaces.
        string[] artifacts;
    }
    /// @dev Owns the positions and independent accounting model.
    PositionHandler private handler;

    /// @notice Builds a fresh handler before invariant execution.
    function setUp() external {
        handler = new PositionHandler();
    }

    /// @notice Restricts invariant calls to the handler, excluding tokens, venues, and position internals.
    /// @return targets Single allowed handler contract.
    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// @notice Restricts the handler to nine meaningful state transitions.
    /// @return targets Selector configuration consumed by Foundry.
    function targetSelectors() external view returns (FuzzSelector[] memory targets) {
        targets = new FuzzSelector[](1);
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = PositionHandler.supply.selector;
        selectors[1] = PositionHandler.borrow.selector;
        selectors[2] = PositionHandler.repay.selector;
        selectors[3] = PositionHandler.withdraw.selector;
        selectors[4] = PositionHandler.donate.selector;
        selectors[5] = PositionHandler.recover.selector;
        selectors[6] = PositionHandler.configure.selector;
        selectors[7] = PositionHandler.failedBatch.selector;
        selectors[8] = PositionHandler.unauthorized.selector;
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    /// @notice Every randomized action preserves the independent position and approval model.
    function invariant_positionsMatchModel() external view {
        handler.assertPositions();
    }

    /// @notice Randomized action sequences cannot create or destroy underlying fixture tokens.
    function invariant_underlyingTokensAreConserved() external view {
        handler.assertConservation();
    }

    /// @notice Supplies no optional artifact selector targets to Foundry.
    /// @return Empty configuration array.
    function targetArtifactSelectors() external pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    /// @notice Supplies no optional artifact targets to Foundry.
    /// @return Empty configuration array.
    function targetArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    /// @notice Supplies no optional artifact exclusions to Foundry.
    /// @return Empty configuration array.
    function excludeArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    /// @notice Supplies no optional sender restrictions to Foundry.
    /// @return Empty configuration array.
    function targetSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    /// @notice Supplies no optional sender exclusions to Foundry.
    /// @return Empty configuration array.
    function excludeSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    /// @notice Supplies no optional contract exclusions to Foundry.
    /// @return Empty configuration array.
    function excludeContracts() external pure returns (address[] memory) {
        return new address[](0);
    }

    /// @notice Supplies no optional interface targets to Foundry.
    /// @return Empty configuration array.
    function targetInterfaces() external pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }

    /// @notice Supplies no optional selector exclusions to Foundry.
    /// @return Empty configuration array.
    function excludeSelectors() external pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }
}
