// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Funding, Action, ActionKind, Limits, IERC20 } from "../src/interfaces/Types.sol";
import { IPool, ISpoke, V3ReserveData, V4AccountData } from "../src/interfaces/Protocols.sol";
import { PositionAccount } from "../src/PositionAccount.sol";
import { PositionFactory } from "../src/PositionFactory.sol";

interface Vm {
    function envOr(
        string calldata name,
        string calldata defaultValue
    ) external returns (string memory);
    function createSelectFork(
        string calldata rpcUrl,
        uint256 blockNumber
    ) external returns (uint256);
    function envOr(
        string calldata name,
        uint256 defaultValue
    ) external returns (uint256);
    function createSelectFork(
        string calldata rpcUrl
    ) external returns (uint256);
    function deal(
        address account,
        uint256 newBalance
    ) external;
    function startPrank(
        address account
    ) external;
    function stopPrank() external;
}

interface IWETH {
    function deposit() external payable;
}

interface IStETH {
    function submit(
        address referral
    ) external payable returns (uint256);
}

interface IWstETH {
    function wrap(
        uint256 stETHAmount
    ) external returns (uint256);
}

/// @notice Opt-in real Aave fork coverage. It is skipped unless RUN_AAVE_LIVE_FORK=1.
/// @dev The test uses Foundry state deals only to provide test capital; every action and
/// every risk read is against the deployed native Pool/Spoke at the selected fork block.
contract LiveForkLifecycleTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address private constant V4_MAIN_SPOKE = 0x94e7A5dCbE816e498b89aB752661904E2F56c485;
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address private constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    function testLiveV3CreateBorrowRepayWithdraw() external {
        if (vm.envOr("RUN_AAVE_LIVE_FORK", 0) != 1) return;
        _forkEthereum();
        PositionFactory factory = new PositionFactory();
        bytes32 salt = bytes32(uint256(301));
        address account = factory.predictPosition(OWNER, 3, V3_POOL, salt);
        _prepareOwner(false);
        vm.startPrank(OWNER);
        IERC20(WETH).approve(account, 1e18);
        Funding[] memory funding = new Funding[](1);
        funding[0] = Funding(WETH, 1e18);
        Action[] memory open = new Action[](2);
        open[0] = Action(ActionKind.SUPPLY, WETH, 0, 1e18, true);
        open[1] = Action(ActionKind.BORROW, USDC, 0, 1e6, false);
        factory.createPosition(3, V3_POOL, salt, funding, open, _limits(1.1e18));
        vm.stopPrank();

        (, uint256 debt,,,, uint256 healthFactor) = IPool(V3_POOL).getUserAccountData(account);
        require(debt != 0 && healthFactor > 1.1e18, "v3 native open");

        vm.startPrank(OWNER);
        IERC20(USDC).approve(account, 2e6);
        Funding[] memory repayment = new Funding[](1);
        repayment[0] = Funding(USDC, 2e6);
        Action[] memory close = new Action[](2);
        close[0] = Action(ActionKind.REPAY, USDC, 0, type(uint256).max, false);
        close[1] = Action(ActionKind.WITHDRAW, WETH, 0, type(uint256).max, false);
        PositionAccount(account).execute(repayment, close, _limits(1e18));
        vm.stopPrank();
        (, debt,,,,) = IPool(V3_POOL).getUserAccountData(account);
        require(debt == 0 && IERC20(WETH).balanceOf(account) == 0, "v3 native close");
    }

    function testLiveV4CreateBorrowRepayWithdrawTwoCollateral() external {
        if (vm.envOr("RUN_AAVE_LIVE_FORK", 0) != 1) return;
        _forkEthereum();
        PositionFactory factory = new PositionFactory();
        bytes32 salt = bytes32(uint256(302));
        address account = factory.predictPosition(OWNER, 4, V4_MAIN_SPOKE, salt);
        uint256 wstEthAmount = _prepareOwner(true);
        vm.startPrank(OWNER);
        IERC20(WETH).approve(account, 1e18);
        IERC20(WSTETH).approve(account, wstEthAmount);
        Funding[] memory funding = new Funding[](1);
        funding[0] = Funding(WETH, 1e18);
        Action[] memory open = new Action[](2);
        open[0] = Action(ActionKind.SUPPLY, WETH, 0, 1e18, true);
        open[1] = Action(ActionKind.BORROW, USDC, 7, 1e6, false);
        factory.createPosition(4, V4_MAIN_SPOKE, salt, funding, open, _limits(1.1e18));
        vm.stopPrank();

        V4AccountData memory data = ISpoke(V4_MAIN_SPOKE).getUserAccountData(account);
        require(data.activeCollateralCount == 1, "v4 starts with one collateral");
        uint256 initialHealthFactor = data.healthFactor;
        vm.startPrank(OWNER);
        Funding[] memory additionalFunding = new Funding[](1);
        additionalFunding[0] = Funding(WSTETH, wstEthAmount);
        Action[] memory addCollateral = new Action[](1);
        addCollateral[0] = Action(ActionKind.SUPPLY, WSTETH, 1, wstEthAmount, true);
        PositionAccount(account).execute(additionalFunding, addCollateral, _limits(1.1e18));
        vm.stopPrank();
        data = ISpoke(V4_MAIN_SPOKE).getUserAccountData(account);
        require(data.activeCollateralCount == 2 && data.borrowCount == 1, "v4 native open");
        require(data.healthFactor > initialHealthFactor, "same account benefits from added collateral");
        require(data.healthFactor > 1.1e18, "v4 native health");

        vm.startPrank(OWNER);
        IERC20(USDC).approve(account, 2e6);
        Funding[] memory repayment = new Funding[](1);
        repayment[0] = Funding(USDC, 2e6);
        Action[] memory close = new Action[](3);
        close[0] = Action(ActionKind.REPAY, USDC, 7, type(uint256).max, false);
        close[1] = Action(ActionKind.WITHDRAW, WETH, 0, type(uint256).max, false);
        close[2] = Action(ActionKind.WITHDRAW, WSTETH, 1, type(uint256).max, false);
        PositionAccount(account).execute(repayment, close, _limits(1e18));
        vm.stopPrank();
        data = ISpoke(V4_MAIN_SPOKE).getUserAccountData(account);
        require(data.borrowCount == 0 && data.activeCollateralCount == 0, "v4 native close");
    }

    function _limits(
        uint256 minHealthFactor
    ) private view returns (Limits memory) {
        return Limits(block.timestamp + 1 days, minHealthFactor, type(uint256).max);
    }

    function _forkEthereum() private {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        uint256 blockNumber = vm.envOr("FORK_BLOCK", 0);
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
    }

    function _prepareOwner(
        bool includeWstEth
    ) private returns (uint256 wstEthAmount) {
        vm.deal(OWNER, 20 ether);
        vm.startPrank(OWNER);
        IWETH(WETH).deposit{ value: 2 ether }();
        if (includeWstEth) {
            IStETH(STETH).submit{ value: 2 ether }(OWNER);
            uint256 stEthAmount = IERC20(STETH).balanceOf(OWNER);
            IERC20(STETH).approve(WSTETH, stEthAmount);
            IWstETH(WSTETH).wrap(1e18);
            wstEthAmount = IERC20(WSTETH).balanceOf(OWNER);
        }
        vm.stopPrank();
        // Fund repayment from the V3 Pool's underlying balance so the V4 Hub's
        // tracked token/liquidity accounting is not disturbed by test setup.
        vm.startPrank(V3_POOL);
        require(IERC20(USDC).transfer(OWNER, 2e6), "test repayment funding transfer");
        vm.stopPrank();
    }
}
