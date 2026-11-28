// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Validates ERC20 calls that return either no data or a boolean success value.
library SafeToken {
    /// @notice The target has no code, the token call reverted, or its return data did not signal success.
    /// @param token Underlying ERC20 token contract.
    error TokenCallFailed(address token);

    /// @notice Calls an ERC20 and rejects reverts, malformed results, or false returns.
    /// @dev The target must have code. Empty return data is accepted for tokens without boolean return values.
    /// @param token Underlying ERC20 token contract.
    /// @param data ABI-encoded token call.
    /// @return result Raw return data from the successful token call.
    function invoke(
        address token,
        bytes memory data
    ) internal returns (bytes memory result) {
        if (token.code.length == 0) revert TokenCallFailed(token);
        (bool ok, bytes memory returned) = token.call(data);
        if (!ok || (returned.length != 0 && (returned.length != 32 || !abi.decode(returned, (bool))))) {
            revert TokenCallFailed(token);
        }
        return returned;
    }
}
