pragma solidity >=0.8.13;

import "../JCETHPlaceholderBase.sol";

contract JCETHPlaceholderTest is JCETHPlaceholderBase {
    function getCount() public pure returns (uint256) {
        return 33;
    }
}
