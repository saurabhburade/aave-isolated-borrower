// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library SafeToken {
    error TokenCallFailed(address token);

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
