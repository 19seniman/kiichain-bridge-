const { ethers } = require("ethers");
const axios = require("axios");
const cron = require("node-cron");
const chalk = require("chalk");
const readline = require("readline");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  rpc: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/",
  chainId: 1336,
  chainName: "KiiChain Testnet Oro",
  symbol: "KII",
  explorer: "https://explorer.kiichain.io",
  transferAmount: "0.0001",
  cronSchedule: "0 8 * * *",
};

// ─── LOGGER ───────────────────────────────────────────────────────────────────
function timestamp() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}
const log = {
  info:    (msg) => console.log(chalk.cyan(`[INFO] ${timestamp()} ${msg}`)),
  success: (msg) => console.log(chalk.green(`[OK]   ${timestamp()} ${msg}`)),
  warn:    (msg) => console.log(chalk.yellow(`[WARN] ${timestamp()} ${msg}`)),
  error:   (msg) => console.log(chalk.red(`[ERR]  ${timestamp()} ${msg}`)),
  title:   (msg) => console.log(chalk.bold.magenta(`\n${"═".repeat(55)}\n  ${msg}\n${"═".repeat(55)}`)),
};

// ─── INPUT PRIVATE KEY DARI TERMINAL ─────────────────────────────────────────
function promptPrivateKey() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Sembunyikan input saat mengetik
    const rlout = rl.output;
    rl.question(chalk.yellow("\n🔑 Masukkan Private Key wallet kamu: "), (answer) => {
      rlout.write("\n");
      rl.close();
      resolve(answer.trim());
    });

    // Sembunyikan karakter yang diketik
    rl._writeToOutput = (str) => {
      if (str === "\r\n" || str === "\n" || str === "\r") {
        rlout.write("\n");
      } else {
        rlout.write("*");
      }
    };
  });
}

// ─── INISIALISASI WALLET ──────────────────────────────────────────────────────
function createWallet(privateKey) {
  const provider = new ethers.JsonRpcProvider(CONFIG.rpc, {
    chainId: CONFIG.chainId,
    name: CONFIG.chainName,
  });

  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;

  try {
    const wallet = new ethers.Wallet(pk, provider);
    return { wallet, provider };
  } catch (e) {
    log.error("Format private key tidak valid! Pastikan 64 karakter hex.");
    process.exit(1);
  }
}

// ─── 1. CEK SALDO & STATUS WALLET ─────────────────────────────────────────────
async function checkWallet(wallet, provider) {
  log.title("CEK STATUS WALLET");
  try {
    const address = wallet.address;
    const balance = await provider.getBalance(address);
    const balanceFormatted = ethers.formatEther(balance);
    const block = await provider.getBlockNumber();

    log.success(`Address   : ${address}`);
    log.success(`Saldo     : ${balanceFormatted} ${CONFIG.symbol}`);
    log.success(`Block     : #${block}`);
    log.info(`Explorer  : ${CONFIG.explorer}/address/${address}`);

    if (parseFloat(balanceFormatted) < 0.001) {
      log.warn("Saldo rendah! Coba klaim faucet terlebih dahulu.");
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
  log.info(`Alamat: ${address}`);

  const endpoints = [
    { name: "KiiChain Faucet v1", url: "https://faucet.kiichain.io/faucet",        data: { address } },
    { name: "KiiChain Faucet v2", url: "https://faucet.kiichain.io/api/faucet",    data: { address } },
    { name: "KiiChain Faucet v3", url: "https://faucet-api.kiichain.io/faucet",    data: { address } },
  ];

  for (const ep of endpoints) {
    try {
      log.info(`Mencoba: ${ep.name}...`);
      const response = await axios.post(ep.url, ep.data, {
        timeout: 15000,
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 200) {
        log.success(`✅ Faucet berhasil via ${ep.name}!`);
        log.info(`Response: ${JSON.stringify(response.data).slice(0, 200)}`);
        return true;
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      if (/cooldown|already|wait|limit/i.test(msg)) {
        log.warn(`Faucet cooldown — coba lagi besok.`);
        return false;
      }
      log.warn(`${ep.name} gagal: ${msg}`);
    }
  }

  log.warn("Semua endpoint faucet gagal.");
  log.info("Klaim manual: https://explorer.kiichain.io/faucet");
  log.info("Atau Discord KiiChain → channel #faucet → ketik: $request 0xAlamatKamu");
  return false;
}

// ─── JALANKAN SEMUA TUGAS ─────────────────────────────────────────────────────
async function runDailyTasks(wallet, provider) {
  log.title(`🤖 KIICHAIN DAILY BOT — ${new Date().toLocaleDateString("id-ID")}`);

  // 1. Cek saldo awal
  let walletInfo;
  try {
    walletInfo = await checkWallet(wallet, provider);
  } catch {
    log.error("Gagal cek wallet, membatalkan tugas.");
    return;
  }

  // 2. Request faucet
  await requestFaucet(walletInfo.address);

  // 3. Self-transfer
  const minBalance = parseFloat(CONFIG.transferAmount) + 0.0005;
  if (parseFloat(walletInfo.balance) >= minBalance) {
    await selfTransfer(wallet);
  } else {
    log.warn(`Saldo tidak cukup untuk self-transfer (minimal ${minBalance} ${CONFIG.symbol})`);
  }

  // 4. Cek saldo akhir
  log.title("SALDO AKHIR");
  await checkWallet(wallet, provider);

  log.success(`\n✅ Semua tugas harian selesai! Sampai besok 🚀\n`);
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
async function main() {
  console.log(chalk.bold.magenta(`
╔═══════════════════════════════════════════╗
║        🤖 KIICHAIN DAILY BOT              ║
║        KiiChain Testnet Oro               ║
╚═══════════════════════════════════════════╝`));

  // Ambil private key dari argumen atau prompt
  let privateKey = process.argv[2];

  if (!privateKey) {
    privateKey = await promptPrivateKey();
  }

  if (!privateKey || privateKey.length < 60) {
    log.error("Private key tidak valid (terlalu pendek)!");
    process.exit(1);
  }

  const { wallet, provider } = createWallet(privateKey);
  log.success(`Wallet loaded: ${wallet.address}`);

  const args = process.argv.slice(2).filter(a => a.startsWith("-"));

  if (args.includes("--check") || args.includes("-c")) {
    await checkWallet(wallet, provider);
  } else if (args.includes("--faucet") || args.includes("-f")) {
    await requestFaucet(wallet.address);
  } else if (args.includes("--transfer") || args.includes("-t")) {
    await selfTransfer(wallet);
  } else {
    // Default: jalankan semua + jadwalkan cron
    await runDailyTasks(wallet, provider);

    log.title("⏰ MODE TERJADWAL AKTIF");
    log.info(`Bot akan berjalan otomatis setiap hari jam 08:00 WIB`);
    log.info(`Tekan Ctrl+C untuk berhenti\n`);

    cron.schedule(CONFIG.cronSchedule, async () => {
      log.info("⏰ Cron job dimulai...");
      await runDailyTasks(wallet, provider);
    }, { timezone: "Asia/Jakarta" });
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
