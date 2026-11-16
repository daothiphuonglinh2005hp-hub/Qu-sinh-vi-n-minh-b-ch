n// Kịch bản trình diễn từ đầu đến cuối (chạy trên mạng Hardhat trong bộ nhớ):
//   npx hardhat run scripts/demo.js
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DAY = 24 * 3600;
const hash = (s) => hre.ethers.keccak256(hre.ethers.toUtf8Bytes(s));
const eth = (v) => hre.ethers.parseEther(String(v));
const log = (step, msg) => console.log(`\n[Bước ${step}] ${msg}`);

async function main() {
  const { ethers } = hre;
  const [a, b, c, d, e, sv1, sv2, sponsor, vendor] = await ethers.getSigners();

  log(1, "Triển khai hợp đồng: 5 quản lý, ngưỡng 3/5, timelock 24 giờ");
  const Fund = await ethers.getContractFactory("StudentFund");
  const fund = await Fund.deploy([a, b, c, d, e].map((s) => s.address), 3, eth(5), DAY);
  await fund.waitForDeployment();
  console.log("  Địa chỉ:", await fund.getAddress());

  log(2, "Sinh viên và nhà tài trợ đóng góp (giá trị thử nghiệm)");
  await fund.connect(sv1).donate("Dong gop CLB", { value: eth(1) });
  await fund.connect(sv2).donate("Dong gop CLB", { value: eth(1) });
  await fund.connect(sponsor).donate("Nha tai tro cuoc thi", { value: eth(8) });
  console.log("  Số dư quỹ:", ethers.formatEther(await fund.balance()), "ETH");

  log(3, "Quản lý A tạo đề xuất mua giải thưởng (đính kèm mã băm bảng dự toán)");
  await fund.connect(a).createProposal(vendor.address, eth(2), hash("bang-du-toan-giai-thuong.pdf"), 7 * DAY);
  await fund.connect(a).approve(1);
  await fund.connect(b).approve(1);
  console.log("  Sau 2 chữ ký, trạng thái =", (await fund.proposals(1)).status.toString(), "(1 = Created)");
  await fund.connect(c).approve(1);
  console.log("  Sau 3 chữ ký, trạng thái =", (await fund.proposals(1)).status.toString(), "(2 = Approved)");

  log(4, "Thử giải ngân sớm (chưa hết timelock) -> phải bị từ chối");
  try {
    await fund.execute(1);
    console.log("  LỖI: lẽ ra phải bị từ chối");
  } catch (err) {
    console.log("  Bị từ chối đúng như thiết kế:", err.message.includes("TooEarly") ? "TooEarly" : err.shortMessage || err.message);
  }

  log(5, "Hết timelock, một sinh viên bất kỳ kích hoạt giải ngân");
  await time.increase(DAY + 1);
  const before = await ethers.provider.getBalance(vendor.address);
  await fund.connect(sv1).execute(1);
  const after = await ethers.provider.getBalance(vendor.address);
  console.log("  Nhà cung cấp nhận:", ethers.formatEther(after - before), "ETH");

  log(6, "Thử chi lần hai cho cùng đề xuất -> phải bị từ chối");
  try {
    await fund.execute(1);
    console.log("  LỖI: lẽ ra phải bị từ chối");
  } catch (err) {
    console.log("  Bị từ chối đúng như thiết kế:", err.message.includes("InvalidState") ? "InvalidState" : err.shortMessage || err.message);
  }

  log(7, "Đăng mã băm hóa đơn, hai quản lý khác xác nhận chéo");
  await fund.connect(a).attachReceipt(1, hash("hoa-don-0001.pdf"));
  await fund.connect(b).confirmReceipt(1);
  await fund.connect(d).confirmReceipt(1);
  console.log("  Trạng thái =", (await fund.proposals(1)).status.toString(), "(4 = Documented)");

  log(8, "Kiểm toán: dựng lại sổ cái từ sự kiện on-chain");
  const events = await fund.queryFilter("*");
  for (const ev of events) {
    const args = ev.args ? Array.from(ev.args).map((x) => (typeof x === "bigint" ? x.toString() : x)).join(", ") : "";
    console.log(`  #${ev.blockNumber} ${ev.fragment ? ev.fragment.name : "?"}(${args})`);
  }
  console.log("\n  Tổng thu:", ethers.formatEther(await fund.totalDonated()), "ETH");
  console.log("  Tổng chi:", ethers.formatEther(await fund.totalSpent()), "ETH");
  console.log("  Số dư   :", ethers.formatEther(await fund.balance()), "ETH");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
