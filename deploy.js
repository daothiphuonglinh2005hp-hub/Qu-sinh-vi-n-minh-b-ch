// Triển khai StudentFund.
//   Cục bộ:  npx hardhat node   (cửa sổ 1)
//            npx hardhat run scripts/deploy.js --network localhost   (cửa sổ 2)
//   Sepolia: điền .env rồi chạy  npx hardhat run scripts/deploy.js --network sepolia
//
// Biến môi trường (tùy chọn):
//   MANAGERS=0xabc...,0xdef...,...   danh sách địa chỉ quản lý (>= 3)
//   THRESHOLD=3                      số chữ ký tối thiểu (phải > một nửa số quản lý)
//   MAX_PER_PROPOSAL_ETH=0.5         giới hạn chi mỗi đề xuất (ETH)
//   TIMELOCK_SECONDS=86400           thời gian chờ trước khi giải ngân
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network, artifacts } = hre;
  const signers = await ethers.getSigners();

  const managers = process.env.MANAGERS
    ? process.env.MANAGERS.split(",").map((s) => s.trim())
    : signers.slice(0, 5).map((s) => s.address);
  const threshold = Number(process.env.THRESHOLD || Math.floor(managers.length / 2) + 1);
  const maxPerProposal = ethers.parseEther(process.env.MAX_PER_PROPOSAL_ETH || "5");
  const timelock = Number(process.env.TIMELOCK_SECONDS || 24 * 3600);

  console.log("Mạng:", network.name);
  console.log("Quản lý:", managers);
  console.log("Ngưỡng chữ ký:", threshold, "| timelock (giây):", timelock);

  const Fund = await ethers.getContractFactory("StudentFund");
  const fund = await Fund.deploy(managers, threshold, maxPerProposal, timelock);
  await fund.waitForDeployment();
  const address = await fund.getAddress();
  console.log("StudentFund đã triển khai tại:", address);

  // Lưu địa chỉ + ABI để giao diện web (frontend/index.html) dùng
  const artifact = await artifacts.readArtifact("StudentFund");
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify({ network: network.name, address, managers, threshold, abi: artifact.abi }, null, 2)
  );
  console.log(`Đã ghi deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
