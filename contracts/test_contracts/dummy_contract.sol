// SPDX-License-Identifier: MIT

pragma solidity >=0.8.13;

/**
 * @dev Dummy contract for unit tests
 */
contract DummyContract {
    uint256 private _count;

    uint256 private _accountNumber;
    uint256 private _proposalNumber;
    address private _jcEth;

    struct ExecutionRequest {
        uint256 accountNumber;
        uint256 proposalNumber;
    }

    event DummyEvent(bytes32 msg);

    constructor() {
        _count = 0;
    }

    function helloWorld() public pure returns (string memory) {
        return "Hello world";
    }

    function bump() public returns (uint256) {
        _count += 1;
        return _count;
    }

    function willRevert() public pure {
        require(false, "revert");
    }

    function setCount(uint256 newCount) public returns (uint256) {
        _count = newCount;
        return _count;
    }

    function getCount() public view returns (uint256) {
        return _count;
    }

    function setProposalNumber(uint256 proposalNumber_) public {
        _proposalNumber = proposalNumber_;
    }

    function setAccountNumber(uint256 accountNumber_) public {
        _accountNumber = accountNumber_;
    }

    function setJcEth(address jcEth_) public {
        _jcEth = jcEth_;
    }

    /**
     * @dev This function will try to call execute(proposalHash) again to simulate re-entry attack
     */
    function simulateReEntryAttack() public {
        emit DummyEvent("enter");

        ExecutionRequest memory request = ExecutionRequest(
            _accountNumber,
            _proposalNumber
        );
        bytes memory callData = abi.encodeWithSignature(
            "execute((uint256,uint256))",
            request
        );
        (bool success, bytes memory returnData) = _jcEth.call(callData);
        require(success, string(returnData));
        _count = 33;
    }

    receive() external payable {}
}
