// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFundExecute {
    function execute(uint256 id) external;
}

/// @dev Hợp đồng độc hại CHỈ dùng để kiểm thử: cố gọi lại execute() khi nhận tiền.
contract ReentrancyAttacker {
    IFundExecute public immutable fund;
    uint256 public targetId;
    bool public reenterAttempted;
    bool public reenterSucceeded;

    constructor(address fund_) {
        fund = IFundExecute(fund_);
    }

    function setTarget(uint256 id) external {
        targetId = id;
    }

    receive() external payable {
        reenterAttempted = true;
        try fund.execute(targetId) {
            reenterSucceeded = true;
        } catch {}
    }
}
