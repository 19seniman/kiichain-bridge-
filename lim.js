const { ethers } = require("ethers");
const cron = require("node-cron");
const chalk = require("chalk");
const readline = require("readline");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  rpcList: [
    "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/",
    "https://json-rpc.dos.sentry.testnet.v3.kiivalidator.com/",
    "https://evmrpc-t.kiichain.nodestake.org/",
  ],
  chainId: 1336,
  chainName: "KiiChain Testnet Oro",
  symbol: "KII",
  explorer: "https://explorer.kiichain.io",
  cronSchedule: "0 8 * * *",
};

const AMOUNT_OPTIONS = [
  { label: "0.001 KII  (sangat kecil)", value: "0.001" },
  { label: "0.005 KII  (kecil)", value: "0.005" },
  { label: "0.010 KII  (sedang)", value: "0.010" },
  { label: "0.025 KII  (sedang+)", value: "0.025" },
  { label: "0.050 KII  (besar)", value: "0.050" },
  { label: "0.100 KII  (maksimal)", value: "0.100" },
  { label: "Custom     (masukkan sendiri)", value: "custom" },
];

const TX_COUNT_OPTIONS = [
  { label: "1x  transaksi", value: 1 },
  { label: "3x  transaksi", value: 3 },
  { label: "5x  transaksi", value: 5 },
  { label: "10x transaksi", value: 10 },
  { label: "Custom (masukkan sendiri)", value: 0 },
];

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
  divider: ()    => console.log(chalk.gray("─".repeat(55))),
};

// ─── INPUT HELPER ─────────────────────────────────────────────────────────────
function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function askQuestion(question) {
  return new Promise((resolve) => {
    const rl = createRL();
    rl.question(chalk.yellow(question), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptSecret(question) {
  return new Promise((resolve) => {
    const rl = createRL();
    rl._writeToOutput = (str) => {
      if (["\r\n", "\n", "\r"].includes(str)) rl.output.write("\n");
      else rl.output.write("*");
    };
    rl.question(chalk.yellow(question), (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── MENU PILIHAN ─────────────────────────────────────────────────────────────
async function showMenu(title, options) {
  console.log(chalk.bold.cyan(`\n  ${title}`));
  log.divider();
  options.forEach((opt, i) => {
    console.log(chalk.white(`  [${i + 1}] ${opt.label}`));
  });
  log.divider();

  while (true) {
    const input = await askQuestion(`  Pilih [1-${options.length}]: `);
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
    log.warn(`Pilihan tidak valid. Masukkan angka 1 sampai ${options.length}.`);
  }
}

async function selectAmount() {
  const chosen = await showMenu("💰 PILIH JUMLAH TOKEN KII PER TRANSAKSI:", AMOUNT_OPTIONS);

  if (chosen.value === "custom") {
    while (true) {
      const input = await askQuestion("  Masukkan jumlah KII (0.001 - 0.1): ");
      const val = parseFloat(input);
      if (!isNaN(val) && val >= 0.001 && val <= 0.1) {
        return val.toString();
      }
      log.warn("Jumlah harus antara 0.001 dan 0.1 KII.");
    }
  }

  return chosen.value;
}

async function selectTxCount() {
  const chosen = await showMenu("🔁 PILIH JUMLAH TRANSAKSI PER SESI:", TX_COUNT_OPTIONS);

  if (chosen.value === 0) {
    while (true) {
      const input = await askQuestion("  Masukkan jumlah transaksi (1 - 50): ");
      const val = parseInt(input);
      if (!isNaN(val) && val >= 1 && val <= 50) return val;
      log.warn("Jumlah harus antara 1 dan 50.");
    }
  }

  return chosen.value;
}

// ─── KONEKSI RPC DENGAN FALLBACK ──────────────────────────────────────────────
async function connectProvider() {
  for (const rpc of CONFIG.rpcList) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, {
        chainId: CONFIG.chainId,
        name: CONFIG.chainName,
      });
      await provider.getBlockNumber();
      log.success(`Terhubung ke RPC: ${rpc}`);
      return provider;
    } catch {
      log.warn(`RPC gagal: ${rpc}, mencoba berikutnya...`);
    }
  }
  log.error("Semua RPC gagal! Periksa koneksi internet.");
  process.exit(1);
}

// ─── INISIALISASI WALLET ──────────────────────────────────────────────────────
function createWallet(privateKey, provider) {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  try {
    return new ethers.Wallet(pk, provider);
  } catch {
    log.error("Format private key tidak valid!");
    process.exit(1);
  }
}

// ─── CEK SALDO ────────────────────────────────────────────────────────────────
async function checkWallet(wallet) {
  log.title("📊 STATUS WALLET");
  try {
    const [balance, block] = await Promise.all([
      wallet.provider.getBalance(wallet.address),
      wallet.provider.getBlockNumber(),
    ]);
    const bal = ethers.formatEther(balance);

    log.success(`Address : ${wallet.address}`);
    log.success(`Saldo   : ${parseFloat(bal).toFixed(6)} ${CONFIG.symbol}`);
    log.success(`Block   : #${block}`);
    log.info(`Link    : ${CONFIG.explorer}/address/${wallet.address}`);

    if (parseFloat(bal) < 0.005) {
      log.warn("Saldo rendah! Klaim faucet:");
      log.info("→ Discord : https://discord.gg/kiichain → #faucet → $request " + wallet.address);
      log.info("→ Explorer: https://explorer.kiichain.io/faucet");
    }

    return { address: wallet.address, balance: bal };
  } catch (err) {
    log.error(`Gagal cek wallet: ${err.message}`);
    throw err;
  }
}

// ─── CHECK-IN / SELF-TRANSFER ─────────────────────────────────────────────────
async function doCheckIn(wallet, amount, txCount) {
  log.title(`✅ CHECK-IN HARIAN — ${txCount}x @ ${amount} ${CONFIG.symbol}`);

  const balance = await wallet.provider.getBalance(wallet.address);
  const bal = parseFloat(ethers.formatEther(balance));
  const totalNeeded = (parseFloat(amount) * txCount) + (0.001 * txCount); // amount + estimasi gas

  if (bal < totalNeeded) {
    log.warn(`Saldo tidak cukup! Butuh ±${totalNeeded.toFixed(4)} ${CONFIG.symbol}, saldo: ${bal.toFixed(6)}`);
    return [];
  }

  const results = [];

  for (let i = 1; i <= txCount; i++) {
    log.divider();
    log.info(`Transaksi ${i}/${txCount} — mengirim ${amount} ${CONFIG.symbol}...`);

    try {
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther(amount),
        gasLimit: 21000,
      });

      log.info(`TX Hash : ${tx.hash}`);
      log.info(`Menunggu konfirmasi...`);
      const receipt = await tx.wait();

      log.success(`✅ TX ${i}/${txCount} BERHASIL! Block #${receipt.blockNumber}`);
      log.success(`   ${CONFIG.explorer}/tx/${tx.hash}`);

      results.push({ txHash: tx.hash, block: receipt.blockNumber.toString(), status: "success" });

      // Jeda antar transaksi agar tidak rate-limited
      if (i < txCount) {
        log.info(`Jeda 3 detik sebelum transaksi berikutnya...`);
        await sleep(3000);
      }
    } catch (err) {
      log.error(`TX ${i}/${txCount} gagal: ${err.message}`);
      results.push({ txHash: null, status: "failed", error: err.message });
    }
  }

  // Simpan log
  const fs = require("fs");
  const logFile = "checkin-log.json";
  let logs = [];
  if (fs.existsSync(logFile)) {
    try { logs = JSON.parse(fs.readFileSync(logFile, "utf8")); } catch {}
  }
  logs.push({
    date: new Date().toISOString(),
    amount,
    txCount,
    results,
    address: wallet.address,
  });
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));

  const successCount = results.filter(r => r.status === "success").length;
  log.divider();
  log.success(`Selesai: ${successCount}/${txCount} transaksi berhasil`);
  log.info(`Log disimpan ke checkin-log.json (total sesi: ${logs.length})`);

  return results;
}

// ─── RIWAYAT CHECK-IN ─────────────────────────────────────────────────────────
function showHistory() {
  log.title("📅 RIWAYAT CHECK-IN");
  const fs = require("fs");
  const logFile = "checkin-log.json";

  if (!fs.existsSync(logFile)) {
    log.warn("Belum ada riwayat check-in.");
    return;
  }

  try {
    const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
    if (!logs.length) { log.warn("Log kosong."); return; }

    const totalTx = logs.reduce((s, l) => s + (l.results?.filter(r => r.status === "success").length || 0), 0);
    log.success(`Total sesi  : ${logs.length}`);
    log.success(`Total TX OK : ${totalTx}`);
    log.divider();

    logs.slice(-5).forEach((entry, i) => {
      const date = new Date(entry.date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const ok = entry.results?.filter(r => r.status === "success").length || 0;
      log.info(`Sesi ${logs.length - 4 + i} | ${date}`);
      log.info(`     ${ok}/${entry.txCount}x @ ${entry.amount} KII`);
    });

    if (logs.length > 5) log.info(`... dan ${logs.length - 5} sesi sebelumnya`);
  } catch {
    log.error("Gagal membaca log.");
  }
}

// ─── JALANKAN SEMUA TUGAS HARIAN ──────────────────────────────────────────────
async function runDailyTasks(wallet, amount, txCount) {
  log.title(`🤖 KIICHAIN DAILY BOT — ${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`);
  await checkWallet(wallet);
  await doCheckIn(wallet, amount, txCount);
  await checkWallet(wallet);
  showHistory();
  log.success(`\n✅ Tugas harian selesai! Sampai besok 🚀\n`);
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
async function main() {
  console.log(chalk.bold.magenta(`
╔══════════════════════════════════════════════╗
║        🤖  KIICHAIN DAILY BOT               ║
║            KiiChain Testnet Oro             ║
╚══════════════════════════════════════════════╝`));

  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith("-"));

  // Private key
  let privateKey = args.find(a => !a.startsWith("-"));
  if (!privateKey) privateKey = await promptSecret("🔑 Masukkan Private Key wallet kamu: ");
  if (!privateKey || privateKey.replace(/^0x/, "").length < 60) {
    log.error("Private key tidak valid!");
    process.exit(1);
  }

  const provider = await connectProvider();
  const wallet = createWallet(privateKey, provider);
  log.success(`Wallet   : ${wallet.address}\n`);

  if (flags.includes("--check") || flags.includes("-c")) {
    await checkWallet(wallet);

  } else if (flags.includes("--history") || flags.includes("-h")) {
    showHistory();

  } else {
    // Tampilkan menu pilihan amount & tx count
    const amount = await selectAmount();
    log.success(`Amount dipilih  : ${amount} ${CONFIG.symbol}`);

    const txCount = await selectTxCount();
    log.success(`Jumlah TX       : ${txCount}x`);

    const totalEst = (parseFloat(amount) * txCount).toFixed(4);
    log.info(`Total estimasi  : ~${totalEst} ${CONFIG.symbol} (belum termasuk gas)\n`);

    if (flags.includes("--once") || flags.includes("-o")) {
      // Jalankan sekali tanpa cron
      await runDailyTasks(wallet, amount, txCount);
    } else {
      // Jalankan sekarang + jadwalkan cron
      await runDailyTasks(wallet, amount, txCount);

      log.title("⏰ JADWAL OTOMATIS AKTIF");
      log.info("Bot akan check-in otomatis setiap hari jam 08:00 WIB");
      log.info("Tekan Ctrl+C untuk berhenti\n");

      cron.schedule(CONFIG.cronSchedule, async () => {
        log.info("⏰ Jadwal harian dimulai...");
        await runDailyTasks(wallet, amount, txCount);
      }, { timezone: "Asia/Jakarta" });
    }
  }
}

main().catch(err => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
