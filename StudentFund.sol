// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title StudentFund
 * @notice Quỹ hoạt động sinh viên minh bạch: nhận đóng góp công khai, chi tiền
 *         theo cơ chế đa chữ ký (m-of-n) + timelock, bắt buộc đính kèm và xác
 *         nhận chứng từ (mã băm) sau khi chi.
 * @dev Đây là nguyên mẫu phục vụ học tập, CHƯA được kiểm toán chuyên nghiệp.
 *      Không dùng với tiền thật khi chưa kiểm toán.
 */
contract StudentFund is ReentrancyGuard, Pausable {
    // ------------------------------------------------------------------
    // Kiểu dữ liệu
    // ------------------------------------------------------------------
    enum Status {
        None,        // chưa tồn tại
        Created,     // đã tạo, đang chờ chữ ký
        Approved,    // đủ chữ ký, đang chờ timelock
        Executed,    // đã giải ngân
        Documented,  // đã có chứng từ được xác nhận
        Cancelled    // đã hủy
    }

    struct Proposal {
        address proposer;
        address recipient;
        uint256 amount;
        bytes32 descriptionHash; // mã băm tài liệu kế hoạch/báo giá (lưu ngoài chuỗi)
        bytes32 receiptHash;     // mã băm hóa đơn/biên nhận sau khi chi
        uint64 createdAt;
        uint64 deadline;         // hạn để đủ chữ ký
        uint64 executableAfter;  // mốc sớm nhất được giải ngân (timelock)
        uint32 approvals;
        uint32 confirmations;
        Status status;
    }

    // ------------------------------------------------------------------
    // Trạng thái
    // ------------------------------------------------------------------
    uint32 public constant RECEIPT_CONFIRMATIONS = 2;

    address[] private _managers;
    mapping(address => bool) public isManager;

    uint32 public immutable threshold;        // số chữ ký tối thiểu
    uint256 public immutable maxPerProposal;  // giới hạn chi mỗi đề xuất (wei)
    uint64 public immutable timelock;         // thời gian chờ (giây)

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    mapping(uint256 => mapping(address => bool)) public hasConfirmed;

    mapping(address => uint256) public contributions;
    uint256 public totalDonated;
    uint256 public totalSpent;

    // Bỏ phiếu tạm dừng/tiếp tục khẩn cấp (cần đủ ngưỡng chữ ký)
    uint256 public pauseRound;
    uint32 public pauseVotes;
    mapping(uint256 => mapping(address => bool)) private _pauseVoted;

    // ------------------------------------------------------------------
    // Sự kiện (sổ nhật ký công khai)
    // ------------------------------------------------------------------
    event Donated(address indexed donor, uint256 amount, string note);
    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        address indexed recipient,
        uint256 amount,
        bytes32 descriptionHash
    );
    event Approved(uint256 indexed id, address indexed manager);
    event Executed(uint256 indexed id, address indexed recipient, uint256 amount);
    event ReceiptAttached(uint256 indexed id, bytes32 receiptHash);
    event ReceiptConfirmed(uint256 indexed id, address indexed manager);
    event Cancelled(uint256 indexed id, address indexed by);
    event PauseVote(uint256 indexed round, address indexed manager, uint32 votes);

    // ------------------------------------------------------------------
    // Lỗi tùy chỉnh
    // ------------------------------------------------------------------
    error NotManager();
    error InvalidState();
    error AlreadyDone();
    error TooEarly();
    error Expired();

    modifier onlyManager() {
        if (!isManager[msg.sender]) revert NotManager();
        _;
    }

    // ------------------------------------------------------------------
    // Khởi tạo
    // ------------------------------------------------------------------
    constructor(
        address[] memory managers_,
        uint32 threshold_,
        uint256 maxPerProposal_,
        uint64 timelock_
    ) {
        require(managers_.length >= 3, "need >= 3 managers");
        require(threshold_ <= managers_.length, "threshold too high");
        require(uint256(threshold_) * 2 > managers_.length, "threshold too low");
        require(maxPerProposal_ > 0, "bad max");

        for (uint256 i = 0; i < managers_.length; i++) {
            address m = managers_[i];
            require(m != address(0) && !isManager[m], "bad manager");
            isManager[m] = true;
            _managers.push(m);
        }
        threshold = threshold_;
        maxPerProposal = maxPerProposal_;
        timelock = timelock_;
    }

    // ------------------------------------------------------------------
    // Đóng góp
    // ------------------------------------------------------------------
    function donate(string calldata note) external payable whenNotPaused {
        require(msg.value > 0, "zero value");
        contributions[msg.sender] += msg.value;
        totalDonated += msg.value;
        emit Donated(msg.sender, msg.value, note);
    }

    receive() external payable whenNotPaused {
        require(msg.value > 0, "zero value");
        contributions[msg.sender] += msg.value;
        totalDonated += msg.value;
        emit Donated(msg.sender, msg.value, "");
    }

    // ------------------------------------------------------------------
    // Đề xuất chi và phê duyệt
    // ------------------------------------------------------------------
    function createProposal(
        address recipient,
        uint256 amount,
        bytes32 descriptionHash,
        uint64 duration
    ) external onlyManager whenNotPaused returns (uint256 id) {
        require(recipient != address(0) && recipient != address(this), "bad recipient");
        require(amount > 0 && amount <= maxPerProposal, "bad amount");
        require(amount <= address(this).balance, "insufficient funds");
        require(duration >= 1 days && duration <= 30 days, "bad duration");

        id = ++proposalCount;
        Proposal storage p = proposals[id];
        p.proposer = msg.sender;
        p.recipient = recipient;
        p.amount = amount;
        p.descriptionHash = descriptionHash;
        p.createdAt = uint64(block.timestamp);
        p.deadline = uint64(block.timestamp) + duration;
        p.status = Status.Created;

        emit ProposalCreated(id, msg.sender, recipient, amount, descriptionHash);
    }

    function approve(uint256 id) external onlyManager whenNotPaused {
        Proposal storage p = proposals[id];
        if (p.status != Status.Created) revert InvalidState();
        if (block.timestamp > p.deadline) revert Expired();
        if (hasApproved[id][msg.sender]) revert AlreadyDone();

        hasApproved[id][msg.sender] = true;
        p.approvals += 1;
        emit Approved(id, msg.sender);

        if (p.approvals >= threshold) {
            p.status = Status.Approved;
            p.executableAfter = uint64(block.timestamp) + timelock;
        }
    }

    function cancel(uint256 id) external onlyManager {
        Proposal storage p = proposals[id];
        if (p.status != Status.Created && p.status != Status.Approved) revert InvalidState();
        require(msg.sender == p.proposer, "only proposer");
        p.status = Status.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    // ------------------------------------------------------------------
    // Giải ngân (ai cũng có thể kích hoạt khi đủ điều kiện)
    // ------------------------------------------------------------------
    function execute(uint256 id) external nonReentrant whenNotPaused {
        Proposal storage p = proposals[id];
        if (p.status != Status.Approved) revert InvalidState();
        if (block.timestamp < p.executableAfter) revert TooEarly();
        if (block.timestamp > uint256(p.deadline) + timelock) revert Expired();
        require(address(this).balance >= p.amount, "insufficient funds");

        // checks-effects-interactions: cập nhật trạng thái trước khi chuyển tiền
        p.status = Status.Executed;
        uint256 amount = p.amount;
        address recipient = p.recipient;
        totalSpent += amount;

        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "transfer failed");
        emit Executed(id, recipient, amount);
    }

    // ------------------------------------------------------------------
    // Chứng từ: đăng mã băm và xác nhận chéo
    // ------------------------------------------------------------------
    function attachReceipt(uint256 id, bytes32 receiptHash) external onlyManager {
        Proposal storage p = proposals[id];
        if (p.status != Status.Executed) revert InvalidState();
        require(p.receiptHash == bytes32(0), "receipt exists");
        require(receiptHash != bytes32(0), "empty hash");
        p.receiptHash = receiptHash;
        emit ReceiptAttached(id, receiptHash);
    }

    function confirmReceipt(uint256 id) external onlyManager {
        Proposal storage p = proposals[id];
        if (p.status != Status.Executed || p.receiptHash == bytes32(0)) revert InvalidState();
        require(msg.sender != p.proposer, "proposer cannot confirm");
        if (hasConfirmed[id][msg.sender]) revert AlreadyDone();

        hasConfirmed[id][msg.sender] = true;
        p.confirmations += 1;
        emit ReceiptConfirmed(id, msg.sender);

        if (p.confirmations >= RECEIPT_CONFIRMATIONS) {
            p.status = Status.Documented;
        }
    }

    // ------------------------------------------------------------------
    // Tạm dừng / tiếp tục khẩn cấp (cần đủ ngưỡng chữ ký quản lý)
    // ------------------------------------------------------------------
    function voteTogglePause() external onlyManager {
        if (_pauseVoted[pauseRound][msg.sender]) revert AlreadyDone();
        _pauseVoted[pauseRound][msg.sender] = true;
        pauseVotes += 1;
        emit PauseVote(pauseRound, msg.sender, pauseVotes);

        if (pauseVotes >= threshold) {
            if (paused()) {
                _unpause();
            } else {
                _pause();
            }
            pauseRound += 1;
            pauseVotes = 0;
        }
    }

    // ------------------------------------------------------------------
    // Hàm xem
    // ------------------------------------------------------------------
    function getManagers() external view returns (address[] memory) {
        return _managers;
    }

    function managerCount() external view returns (uint256) {
        return _managers.length;
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
