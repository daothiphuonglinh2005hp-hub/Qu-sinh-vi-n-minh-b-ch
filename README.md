# StudentFund – Quản lý quỹ hoạt động sinh viên minh bạch trên blockchain

Mã nguồn đi kèm báo cáo học phần **Công nghệ Blockchain**. Đây là **nguyên mẫu học tập**,
chưa được kiểm toán chuyên nghiệp – không dùng với tiền thật.

## Tính năng đã cài đặt

| Chức năng | Hàm / cơ chế |
|---|---|
| Nhận đóng góp công khai kèm ghi chú | `donate(note)`, `receive()`, sự kiện `Donated` |
| Tạo đề xuất chi (chỉ quản lý) | `createProposal(...)`, giới hạn `maxPerProposal` |
| Phê duyệt đa chữ ký m-of-n | `approve(id)`, mỗi quản lý một lần |
| Timelock trước khi giải ngân | `executableAfter` |
| Giải ngân an toàn (checks-effects-interactions + `nonReentrant`) | `execute(id)` |
| Đăng và xác nhận chéo chứng từ (mã băm) | `attachReceipt`, `confirmReceipt` (người tạo không tự xác nhận) |
| Hủy đề xuất | `cancel(id)` (người tạo) |
| Tạm dừng khẩn cấp bằng đủ ngưỡng chữ ký | `voteTogglePause()` |

**Chưa cài đặt (chỉ ở mức thiết kế trong báo cáo):** biểu quyết cộng đồng cho khoản chi lớn,
phân lớp chi nhỏ/vừa/lớn, thay đổi danh sách quản lý, giới hạn chi theo chu kỳ.

## Yêu cầu

- Node.js 18 hoặc 20 LTS (khuyến nghị), npm 7+
- (Tùy chọn) ví MetaMask để dùng giao diện web

## Cài đặt và chạy

```bash
npm install
npx hardhat compile
npx hardhat test          # chạy toàn bộ kiểm thử
npm run test:gas          # kèm báo cáo gas (số liệu thật cho Bảng 4.7 trong báo cáo)
npx hardhat coverage      # độ phủ kiểm thử
npm run demo              # chạy kịch bản trình diễn từ đầu đến cuối
```

> Lần đầu chạy `compile`, Hardhat sẽ tải trình biên dịch Solidity 0.8.24, cần có Internet.

## Chạy trên mạng cục bộ và dùng giao diện web

```bash
# Cửa sổ 1
npx hardhat node

# Cửa sổ 2
npm run deploy:local          # in ra địa chỉ hợp đồng, ghi deployments/localhost.json
```

1. Mở MetaMask → thêm mạng `http://127.0.0.1:8545`, chain ID `31337`.
2. Nhập khóa riêng tư của các tài khoản test do `hardhat node` in ra (tài khoản #0–#4 là quản lý).
3. Mở file `frontend/index.html` bằng trình duyệt, bấm **Kết nối ví**, dán địa chỉ hợp đồng, bấm **Tải dữ liệu quỹ**.

## Triển khai lên mạng thử nghiệm Sepolia

```bash
cp .env.example .env     # điền SEPOLIA_RPC_URL, PRIVATE_KEY của ví TEST
npm run deploy:sepolia
```

Cần ETH thử nghiệm Sepolia (lấy từ faucet). Có thể đặt danh sách quản lý riêng bằng biến `MANAGERS`.

## Cấu trúc thư mục

```
contracts/StudentFund.sol            Hợp đồng chính
contracts/test/ReentrancyAttacker.sol Hợp đồng độc hại, chỉ để kiểm thử
test/StudentFund.test.js             Bộ kiểm thử (khớp bảng ca kiểm thử T01–T20 trong báo cáo)
scripts/deploy.js                    Triển khai, ghi địa chỉ + ABI
scripts/demo.js                      Kịch bản trình diễn
frontend/index.html                  Giao diện web đơn giản (ethers v6 + MetaMask)
```

## Lưu ý bảo mật và pháp lý

- Không đưa khóa riêng tư vào mã nguồn hoặc commit lên GitHub (`.env` đã nằm trong `.gitignore`).
- Mỗi quản lý nên dùng ví riêng, tốt nhất là ví phần cứng.
- Chỉ mã băm chứng từ được ghi lên chuỗi; tệp gốc lưu ngoài chuỗi (IPFS, kho của trường).
- Việc dùng tài sản mã hóa cho quỹ thật của nhà trường hoặc đoàn – hội cần được tham vấn
  quy định tài chính và pháp luật hiện hành.
