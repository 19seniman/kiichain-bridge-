require("dotenv").config();
const { ethers } = require("ethers");
const axios = require("axios");
const cron = require("node-cron");
const chalk = require("chalk");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  rpc: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/",
  chainId: 1336,
  chainName: "KiiChain Testnet Oro",
  symbol: "KII",
  explorer: "https://explorer.kiichain.io",
  faucetApi: "https://faucet.kiichain.io/faucet",
  transferAmount: process.env.TRANSFER_AMOUNT || "0.0001",
  cronSchedule: process.env.CRON_SCHEDULE || "0 8 * * *",
};

// ─── LOGGER ───────────────────────────────────────────────────────────────────
const log = {
  info: (msg) => console.log(chalk.cyan(`[INFO] ${timestamp()} ${msg}`)),
  success: (msg) => console.log(chalk.green(`[OK]   ${timestamp()} ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[WARN] ${timestamp()} ${msg}`)),
  error: (msg) => console.log(chalk.red(`[ERR]  ${timestamp()} ${msg}`)),
  title: (msg) => console.log(chalk.bold.magenta(`\n${"═".repeat(55)}\n  ${msg}\n${"═".repeat(55)}`)),
};

function timestamp() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

// ─── INISIALISASI PROVIDER & WALLET ───────────────────────────────────────────
function initWallet() {
  if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === "your_private_key_here") {
    log.error("PRIVATE_KEY belum diset di file .env !");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CONFIG.rpc, {
    chainId: CONFIG.chainId,
    name: CONFIG.chainName,
  });

  const privateKey = process.env.PRIVATE_KEY.startsWith("0x")
    ? process.env.PRIVATE_KEY
    : `0x${process.env.PRIVATE_KEY}`;

  const wallet = new ethers.Wallet(privateKey, provider);
  return { wallet, provider };
}

// ─── 1. CEK SALDO & STATUS WALLET ─────────────────────────────────────────────
async function checkWallet(wallet, provider) {
  log.title("CEK STATUS WALLET");

  try {
    const address = wallet.address;
    const balance = await provider.getBalance(address);
    const balanceFormatted = ethers.formatEther(balance);
    const block = await provider.getBlockNumber();
    const network = await provider.getNetwork();

    log.success(`Address   : ${address}`);
    log.success(`Saldo     : ${balanceFormatted} ${CONFIG.symbol}`);
    log.success(`Block     : #${block}`);
    log.success(`Network   : ${network.name} (Chain ID: ${network.chainId})`);
    log.info(`Explorer  : ${CONFIG.explorer}/address/${address}`);

    if (parseFloat(balanceFormatted) < 0.001) {
      log.warn("Saldo rendah! Pertimbangkan klaim faucet terlebih dahulu.");
    }

    return { address, balance: balanceFormatted };
  } catch (err) {
    log.error(`Gagal cek wallet: ${err.message}`);
    throw err;
  }
}

// ─── 2. SELF-TRANSFER HARIAN ──────────────────────────────────────────────────
async function selfTransfer(wallet) {
  log.title("SELF-TRANSFER HARIAN");

  try {
    const address = wallet.address;
    const amount = ethers.parseEther(CONFIG.transferAmount);

    log.info(`Mengirim ${CONFIG.transferAmount} ${CONFIG.symbol} ke diri sendiri...`);
    log.info(`From : ${address}`);
    log.info(`To   : ${address}`);

    const tx = await wallet.sendTransaction({
      to: address,
      value: amount,
      gasLimit: 21000,
    });

    log.info(`TX Hash  : ${tx.hash}`);
    log.info(`Menunggu konfirmasi...`);

    const receipt = await tx.wait();

    log.success(`✅ Transaksi BERHASIL!`);
    log.success(`Block    : #${receipt.blockNumber}`);
    log.success(`Gas used : ${receipt.gasUsed.toString()}`);
    log.success(`Explorer : ${CONFIG.explorer}/tx/${tx.hash}`);

    return tx.hash;
  } catch (err) {
    log.error(`Gagal self-transfer: ${err.message}`);
    throw err;
  }
}

// ─── 3. REQUEST FAUCET ────────────────────────────────────────────────────────
async function requestFaucet(address) {
  log.title("REQUEST FAUCET TESTNET");

  // Coba beberapa endpoint faucet yang diketahui
  const endpoints = [
    {
      name: "KiiChain Explorer Faucet",
      url: "https://faucet.kiichain.io/faucet",
      method: "POST",
      data: { address },
    },
    {
      name: "NodeStake Faucet",
      url: "https://api-t.kiichain.nodestake.org/cosmos/bank/v1beta1/balances/" + address,
      method: "GET",
    },
  ];

  log.info(`Mencoba klaim faucet untuk: ${address}`);

  for (const ep of endpoints) {
    try {
      log.info(`Mencoba: ${ep.name}...`);

      let response;
      if (ep.method === "POST") {
        response = await axios.post(ep.url, ep.data, {
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
        });
      } else {
        response = await axios.get(ep.url, { timeout: 15000 });
      }

      if (response.status === 200) {
        log.success(`✅ Request faucet berhasil via ${ep.name}!`);
        log.info(`Response: ${JSON.stringify(response.data).slice(0, 200)}`);
        return true;
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      if (msg?.toLowerCase().includes("cooldown") || msg?.toLowerCase().includes("already") || msg?.toLowerCase().includes("wait")) {
        log.warn(`Faucet masih cooldown (24 jam). Coba lagi besok.`);
      } else {
        log.warn(`${ep.name} gagal: ${msg}`);
      }
    }
  }

  log.warn("Semua endpoint faucet tidak berhasil.");
  log.info("Klaim manual: https://explorer.kiichain.io/faucet");
  log.info("Atau via Discord: https://discord.gg/kiichain → #faucet");
  return false;
}

// ─── JALANKAN SEMUA TUGAS ─────────────────────────────────────────────────────
async function runDailyTasks() {
  log.title(`🤖 KIICHAIN DAILY BOT — ${new Date().toLocaleDateString("id-ID")}`);

  let wallet, provider;

  try {
    ({ wallet, provider } = initWallet());
  } catch (err) {
    log.error("Gagal inisialisasi wallet. Periksa .env kamu.");
    return;
  }

  // 1. Cek saldo
  let walletInfo;
  try {
    walletInfo = await checkWallet(wallet, provider);
  } catch {
    log.error("Gagal cek wallet, membatalkan tugas hari ini.");
    return;
  }

  // 2. Coba faucet
  await requestFaucet(walletInfo.address);

  // 3. Self-transfer (jika saldo cukup)
  const minBalance = parseFloat(CONFIG.transferAmount) + 0.0005; // amount + estimasi gas
  if (parseFloat(walletInfo.balance) >= minBalance) {
    await selfTransfer(wallet);
  } else {
    log.warn(`Saldo tidak cukup untuk self-transfer. Minimal ${minBalance} ${CONFIG.symbol}`);
    log.warn(`Saldo saat ini: ${walletInfo.balance} ${CONFIG.symbol}`);
  }

  // 4. Cek saldo akhir
  log.title("SALDO AKHIR");
  await checkWallet(wallet, provider);

  log.success(`\n✅ Semua tugas harian selesai! Sampai besok 🚀\n`);
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--now") || args.includes("-n")) {
    // Jalankan langsung sekarang
    await runDailyTasks();
  } else if (args.includes("--check") || args.includes("-c")) {
    // Hanya cek saldo
    const { wallet, provider } = initWallet();
    await checkWallet(wallet, provider);
  } else if (args.includes("--faucet") || args.includes("-f")) {
    // Hanya minta faucet
    const { wallet } = initWallet();
    await requestFaucet(wallet.address);
  } else if (args.includes("--transfer") || args.includes("-t")) {
    // Hanya self-transfer
    const { wallet } = initWallet();
    await selfTransfer(wallet);
  } else {
    // Mode default: jalankan sekali dulu, lalu jadwalkan cron
    log.title("🤖 KIICHAIN DAILY BOT — MODE TERJADWAL");
    log.info(`Jadwal: ${CONFIG.cronSchedule} (setiap hari jam 08:00 WIB)`);
    log.info(`Gunakan --now untuk jalankan langsung\n`);

    // Jalankan sekali saat startup
    await runDailyTasks();

    // Jadwalkan cron
    cron.schedule(CONFIG.cronSchedule, async () => {
      log.info("⏰ Cron job dimulai...");
      await runDailyTasks();
    }, {
      timezone: "Asia/Jakarta",
    });

    log.info("\n⏳ Bot berjalan... tekan Ctrl+C untuk berhenti.");
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
