const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DAY = 24 * 3600;
const eth = (v) => ethers.parseEther(String(v));
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("StudentFund", () => {
  async function deployFixture() {
    const [a, b, c, d, e, donor, vendor, stranger] = await ethers.getSigners();
    const managers = [a, b, c, d, e];
    const Fund = await ethers.getContractFactory("StudentFund");
    const fund = await Fund.deploy(managers.map((m) => m.address), 3, eth(5), DAY);
    await fund.waitForDeployment();
    await fund.connect(donor).donate("hoi thao khoa", { value: eth(10) });
    return { fund, a, b, c, d, e, donor, vendor, stranger };
  }

  // Tạo đề xuất #1 và cho đủ 3 chữ ký (a, b, c)
  async function approvedFixture() {
    const f = await deployFixture();
    await f.fund.connect(f.a).createProposal(f.vendor.address, eth(2), hash("bao-gia-v1"), 7 * DAY);
    await f.fund.connect(f.a).approve(1);
    await f.fund.connect(f.b).approve(1);
    await f.fund.connect(f.c).approve(1);
    return f;
  }

  describe("Khởi tạo", () => {
    it("T01: thiết lập tham số đúng", async () => {
      const { fund, a } = await loadFixture(deployFixture);
      expect(await fund.threshold()).to.equal(3);
      expect(await fund.maxPerProposal()).to.equal(eth(5));
      expect(await fund.timelock()).to.equal(DAY);
      expect(await fund.managerCount()).to.equal(5);
      expect(await fund.isManager(a.address)).to.equal(true);
    });

    it("T02: từ chối ngưỡng không quá bán", async () => {
      const signers = await ethers.getSigners();
      const Fund = await ethers.getContractFactory("StudentFund");
      await expect(
        Fund.deploy(signers.slice(0, 5).map((s) => s.address), 2, eth(5), DAY)
      ).to.be.revertedWith("threshold too low");
    });

    it("từ chối ít hơn 3 quản lý", async () => {
      const signers = await ethers.getSigners();
      const Fund = await ethers.getContractFactory("StudentFund");
      await expect(
        Fund.deploy(signers.slice(0, 2).map((s) => s.address), 2, eth(5), DAY)
      ).to.be.revertedWith("need >= 3 managers");
    });
  });

  describe("Đóng góp", () => {
    it("T03: tăng số dư, ghi nhận và phát sự kiện", async () => {
      const { fund, stranger } = await loadFixture(deployFixture);
      await expect(fund.connect(stranger).donate("ung ho", { value: eth(1) }))
        .to.emit(fund, "Donated")
        .withArgs(stranger.address, eth(1), "ung ho");
      expect(await fund.contributions(stranger.address)).to.equal(eth(1));
      expect(await fund.totalDonated()).to.equal(eth(11));
      expect(await fund.balance()).to.equal(eth(11));
    });

    it("T04: từ chối đóng góp bằng 0", async () => {
      const { fund, stranger } = await loadFixture(deployFixture);
      await expect(fund.connect(stranger).donate("x", { value: 0 })).to.be.revertedWith("zero value");
    });

    it("nhận tiền chuyển thẳng tới địa chỉ hợp đồng", async () => {
      const { fund, stranger } = await loadFixture(deployFixture);
      await expect(stranger.sendTransaction({ to: await fund.getAddress(), value: eth(1) }))
        .to.emit(fund, "Donated");
    });
  });

  describe("Đề xuất và phê duyệt", () => {
    it("T05: người lạ không được tạo đề xuất", async () => {
      const { fund, stranger, vendor } = await loadFixture(deployFixture);
      await expect(
        fund.connect(stranger).createProposal(vendor.address, eth(1), hash("x"), 7 * DAY)
      ).to.be.revertedWithCustomError(fund, "NotManager");
    });

    it("T06: từ chối đề xuất vượt giới hạn chi", async () => {
      const { fund, a, vendor } = await loadFixture(deployFixture);
      await expect(
        fund.connect(a).createProposal(vendor.address, eth(6), hash("x"), 7 * DAY)
      ).to.be.revertedWith("bad amount");
    });

    it("T07: tạo đề xuất hợp lệ", async () => {
      const { fund, a, vendor } = await loadFixture(deployFixture);
      await expect(fund.connect(a).createProposal(vendor.address, eth(2), hash("bao-gia-v1"), 7 * DAY))
        .to.emit(fund, "ProposalCreated")
        .withArgs(1, a.address, vendor.address, eth(2), hash("bao-gia-v1"));
      const p = await fund.proposals(1);
      expect(p.status).to.equal(1); // Created
    });

    it("T08: cùng một quản lý không duyệt hai lần", async () => {
      const { fund, a, vendor } = await loadFixture(deployFixture);
      await fund.connect(a).createProposal(vendor.address, eth(2), hash("x"), 7 * DAY);
      await fund.connect(a).approve(1);
      await expect(fund.connect(a).approve(1)).to.be.revertedWithCustomError(fund, "AlreadyDone");
    });

    it("T09: đủ 3 chữ ký thì chuyển sang Approved", async () => {
      const { fund } = await loadFixture(approvedFixture);
      const p = await fund.proposals(1);
      expect(p.status).to.equal(2); // Approved
      expect(p.approvals).to.equal(3);
      expect(p.executableAfter).to.be.gt(0);
    });

    it("chữ ký thứ tư sau khi đã Approved bị từ chối", async () => {
      const { fund, d } = await loadFixture(approvedFixture);
      await expect(fund.connect(d).approve(1)).to.be.revertedWithCustomError(fund, "InvalidState");
    });

    it("T14: không duyệt được đề xuất đã quá hạn", async () => {
      const { fund, a, vendor } = await loadFixture(deployFixture);
      await fund.connect(a).createProposal(vendor.address, eth(2), hash("x"), 1 * DAY);
      await time.increase(2 * DAY);
      await expect(fund.connect(a).approve(1)).to.be.revertedWithCustomError(fund, "Expired");
    });
  });

  describe("Giải ngân", () => {
    it("T10: không giải ngân khi chưa hết timelock", async () => {
      const { fund } = await loadFixture(approvedFixture);
      await expect(fund.execute(1)).to.be.revertedWithCustomError(fund, "TooEarly");
    });

    it("T11: giải ngân sau timelock, tiền đến đúng người nhận", async () => {
      const { fund, vendor } = await loadFixture(approvedFixture);
      await time.increase(DAY + 1);
      await expect(fund.execute(1)).to.changeEtherBalance(vendor, eth(2));
      const p = await fund.proposals(1);
      expect(p.status).to.equal(3); // Executed
      expect(await fund.totalSpent()).to.equal(eth(2));
    });

    it("T12: không chi hai lần cho cùng một đề xuất", async () => {
      const { fund } = await loadFixture(approvedFixture);
      await time.increase(DAY + 1);
      await fund.execute(1);
      await expect(fund.execute(1)).to.be.revertedWithCustomError(fund, "InvalidState");
    });

    it("không giải ngân đề xuất chưa đủ chữ ký", async () => {
      const { fund, a, vendor } = await loadFixture(deployFixture);
      await fund.connect(a).createProposal(vendor.address, eth(2), hash("x"), 7 * DAY);
      await fund.connect(a).approve(1);
      await time.increase(2 * DAY);
      await expect(fund.execute(1)).to.be.revertedWithCustomError(fund, "InvalidState");
    });

    it("T13: chống tấn công reentrancy", async () => {
      const { fund, a, b, c } = await loadFixture(deployFixture);
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(await fund.getAddress());
      await attacker.waitForDeployment();

      await fund.connect(a).createProposal(await attacker.getAddress(), eth(2), hash("evil"), 7 * DAY);
      await attacker.setTarget(1);
      await fund.connect(a).approve(1);
      await fund.connect(b).approve(1);
      await fund.connect(c).approve(1);
      await time.increase(DAY + 1);

      await expect(fund.execute(1)).to.changeEtherBalance(attacker, eth(2));
      expect(await attacker.reenterAttempted()).to.equal(true);
      expect(await attacker.reenterSucceeded()).to.equal(false);
      expect(await fund.totalSpent()).to.equal(eth(2));
    });
  });

  describe("Hủy đề xuất", () => {
    it("T18: người tạo hủy được, sau đó không thể giải ngân", async () => {
      const { fund, a, b, vendor } = await loadFixture(deployFixture);
      await fund.connect(a).createProposal(vendor.address, eth(2), hash("x"), 7 * DAY);
      await expect(fund.connect(a).cancel(1)).to.emit(fund, "Cancelled").withArgs(1, a.address);
      await expect(fund.connect(b).approve(1)).to.be.revertedWithCustomError(fund, "InvalidState");
      await time.increase(2 * DAY);
      await expect(fund.execute(1)).to.be.revertedWithCustomError(fund, "InvalidState");
    });

    it("quản lý khác không được hủy thay người tạo", async () => {
      const { fund, a, b, vendor } = await loadFixture(deployFixture);
      await fund.connect(a).createProposal(vendor.address, eth(2), hash("x"), 7 * DAY);
      await expect(fund.connect(b).cancel(1)).to.be.revertedWith("only proposer");
    });
  });

  describe("Chứng từ", () => {
    it("T15: không đăng chứng từ khi chưa giải ngân", async () => {
      const { fund, a } = await loadFixture(approvedFixture);
      await expect(fund.connect(a).attachReceipt(1, hash("hoadon")))
        .to.be.revertedWithCustomError(fund, "InvalidState");
    });

    it("T16: người tạo không được tự xác nhận chứng từ", async () => {
      const { fund, a } = await loadFixture(approvedFixture);
      await time.increase(DAY + 1);
      await fund.execute(1);
      await fund.connect(a).attachReceipt(1, hash("hoadon"));
      await expect(fund.connect(a).confirmReceipt(1)).to.be.revertedWith("proposer cannot confirm");
    });

    it("T17: đủ 2 xác nhận thì chuyển sang Documented", async () => {
      const { fund, a, b, d } = await loadFixture(approvedFixture);
      await time.increase(DAY + 1);
      await fund.execute(1);
      await expect(fund.connect(a).attachReceipt(1, hash("hoadon")))
        .to.emit(fund, "ReceiptAttached").withArgs(1, hash("hoadon"));
      await fund.connect(b).confirmReceipt(1);
      await expect(fund.connect(b).confirmReceipt(1)).to.be.revertedWithCustomError(fund, "AlreadyDone");
      await fund.connect(d).confirmReceipt(1);
      const p = await fund.proposals(1);
      expect(p.status).to.equal(4); // Documented
      expect(p.receiptHash).to.equal(hash("hoadon"));
    });
  });

  describe("Tạm dừng khẩn cấp", () => {
    it("T19: đủ 3 phiếu thì tạm dừng, chặn các thao tác; đủ 3 phiếu nữa thì tiếp tục", async () => {
      const { fund, a, b, c, stranger } = await loadFixture(deployFixture);
      await fund.connect(a).voteTogglePause();
      await fund.connect(b).voteTogglePause();
      expect(await fund.paused()).to.equal(false);
      await fund.connect(c).voteTogglePause();
      expect(await fund.paused()).to.equal(true);

      await expect(fund.connect(stranger).donate("x", { value: eth(1) }))
        .to.be.revertedWithCustomError(fund, "EnforcedPause");

      await fund.connect(a).voteTogglePause();
      await fund.connect(b).voteTogglePause();
      await fund.connect(c).voteTogglePause();
      expect(await fund.paused()).to.equal(false);
      await fund.connect(stranger).donate("x", { value: eth(1) });
    });

    it("người lạ không được bỏ phiếu tạm dừng", async () => {
      const { fund, stranger } = await loadFixture(deployFixture);
      await expect(fund.connect(stranger).voteTogglePause())
        .to.be.revertedWithCustomError(fund, "NotManager");
    });
  });

  describe("Tính chất tổng quát", () => {
    it("T20: tổng chi không bao giờ vượt tổng thu qua chuỗi thao tác", async () => {
      const { fund, a, b, c, vendor } = await loadFixture(deployFixture);
      for (let i = 1; i <= 3; i++) {
        await fund.connect(a).createProposal(vendor.address, eth(3), hash("dx" + i), 7 * DAY);
        await fund.connect(a).approve(i);
        await fund.connect(b).approve(i);
        await fund.connect(c).approve(i);
      }
      await time.increase(DAY + 1);
      await fund.execute(1);
      await fund.execute(2);
      await fund.execute(3);
      // 3 x 3 = 9 <= 10 đã thu
      expect(await fund.totalSpent()).to.equal(eth(9));
      expect(await fund.totalSpent()).to.be.lte(await fund.totalDonated());
      expect(await fund.balance()).to.equal(eth(1));
    });

    it("không giải ngân khi số dư không đủ", async () => {
      const { fund, a, b, c, vendor } = await loadFixture(deployFixture);
      for (let i = 1; i <= 3; i++) {
        await fund.connect(a).createProposal(vendor.address, eth(4), hash("dx" + i), 7 * DAY);
        await fund.connect(a).approve(i);
        await fund.connect(b).approve(i);
        await fund.connect(c).approve(i);
      }
      await time.increase(DAY + 1);
      await fund.execute(1);
      await fund.execute(2);
      await expect(fund.execute(3)).to.be.revertedWith("insufficient funds");
    });
  });
});
