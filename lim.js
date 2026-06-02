const { ethers } = require("ethers");
const axios = require("axios");
const cron = require("node-cron");
const chalk = require("chalk");
const readline = require("readline");
const fs = require("fs");

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
  backendBase: "https://backend.testnet.kiivalidator.com",
  cronSchedule: "0 8 * * *",
};

const HEADERS = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.7",
  "content-type": "application/json",
  "origin": "https://kiichain.io",
  "referer": "https://kiichain.io/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};

const AMOUNT_OPTIONS = [
  { label: "0.001 KII  (sangat kecil)", value: "0.001" },
  { label: "0.005 KII  (kecil)",        value: "0.005" },
  { label: "0.010 KII  (sedang)",       value: "0.010" },
  { label: "0.025 KII  (sedang+)",      value: "0.025" },
  { label: "0.050 KII  (besar)",        value: "0.050" },
  { label: "0.100 KII  (maksimal)",     value: "0.100" },
  { label: "Custom     (masukkan sendiri)", value: "custom" },
];

const TX_COUNT_OPTIONS = [
  { label: "1x  transaksi",  value: 1  },
  { label: "3x  transaksi",  value: 3  },
  { label: "5x  transaksi",  value: 5  },
  { label: "10x transaksi",  value: 10 },
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
  title:   (msg) => console.log(chalk.bold.magenta(`\n${"═".repeat(57)}\n  ${msg}\n${"═".repeat(57)}`)),
  divider: ()    => console.log(chalk.gray("─".repeat(57))),
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── INPUT HELPERS ────────────────────────────────────────────────────────────
function askQuestion(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow(q), (a) => { rl.close(); resolve(a.trim()); });
  });
}

function promptSecret(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => {
      if (["\r\n","\n","\r"].includes(s)) rl.output.write("\n");
      else rl.output.write("*");
    };
    rl.question(chalk.yellow(q), (a) => { rl.output.write("\n"); rl.close(); resolve(a.trim()); });
  });
}

async function showMenu(title, options) {
  console.log(chalk.bold.cyan(`\n  ${title}`));
  log.divider();
  options.forEach((o, i) => console.log(chalk.white(`  [${i+1}] ${o.label}`)));
  log.divider();
  while (true) {
    const input = await askQuestion(`  Pilih [1-${options.length}]: `);
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
    log.warn(`Pilihan tidak valid. Masukkan 1-${options.length}.`);
  }
}

async function selectAmount() {
  const chosen = await showMenu("💰 PILIH JUMLAH TOKEN KII PER TRANSAKSI:", AMOUNT_OPTIONS);
  if (chosen.value === "custom") {
    while (true) {
      const input = await askQuestion("  Masukkan jumlah KII (0.001 - 0.1): ");
      const val = parseFloat(input);
      if (!isNaN(val) && val >= 0.001 && val <= 0.1) return val.toString();
      log.warn("Jumlah harus antara 0.001 dan 0.1 KII.");
    }
  }
  return chosen.value;
}

async function selectTxCount() {
  const chosen = await showMenu("🔁 PILIH JUMLAH TRANSAKSI ONCHAIN PER SESI:", TX_COUNT_OPTIONS);
  if (chosen.value === 0) {
    while (true) {
      const input = await askQuestion("  Masukkan jumlah transaksi (1-50): ");
      const val = parseInt(input);
      if (!isNaN(val) && val >= 1 && val <= 50) return val;
      log.warn("Jumlah harus antara 1 dan 50.");
    }
  }
  return chosen.value;
}

// ─── KONEKSI RPC ──────────────────────────────────────────────────────────────
async function connectProvider() {
  for (const rpc of CONFIG.rpcList) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, { chainId: CONFIG.chainId, name: CONFIG.chainName });
      await provider.getBlockNumber();
      log.success(`RPC terhubung: ${rpc}`);
      return provider;
    } catch {
      log.warn(`RPC gagal: ${rpc}`);
    }
  }
  log.error("Semua RPC gagal! Periksa koneksi internet.");
  process.exit(1);
}

function createWallet(pk, provider) {
  const key = pk.startsWith("0x") ? pk : `0x${pk}`;
  try { return new ethers.Wallet(key, provider); }
  catch { log.error("Private key tidak valid!"); process.exit(1); }
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function apiGet(path) {
  try {
    const res = await axios.get(`${CONFIG.backendBase}${path}`, { headers: HEADERS, timeout: 15000 });
    return res.data;
  } catch (e) {
    return null;
  }
}

async function apiPost(path, data) {
  try {
    const res = await axios.post(`${CONFIG.backendBase}${path}`, data, { headers: HEADERS, timeout: 15000 });
    return res.data;
  } catch (e) {
    const msg = e.response?.data?.errorMessage || e.response?.data?.message || e.message;
    return { success: false, errorMessage: msg };
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
      log.warn("Saldo rendah! Klaim faucet via Discord: https://discord.gg/kiichain → #faucet");
      log.warn("Atau Explorer: https://explorer.kiichain.io/faucet");
    }
    return { address: wallet.address, balance: bal };
  } catch (err) {
    log.error(`Gagal cek wallet: ${err.message}`);
    throw err;
  }
}

// ─── CEK INFO USER & ORO BALANCE ──────────────────────────────────────────────
async function checkUserInfo(userName, address) {
  log.title("👤 INFO AKUN KIICHAIN");

  // Info user
  const userInfo = await apiGet(`/users/${address}`);
  if (userInfo) {
    log.success(`Username  : ${userInfo.userName || userName}`);
    log.success(`Points    : ${userInfo.points ?? "-"}`);
    log.success(`Referrals : ${userInfo.referrals ?? "-"}`);
  }

  // Saldo ORO
  const oroBalance = await apiGet(`/currency/oro/balance/${address}`);
  if (oroBalance !== null) {
    log.success(`ORO       : ${oroBalance?.balance ?? JSON.stringify(oroBalance)}`);
  }

  // Saldo KII via backend
  const kiiBalance = await apiGet(`/currency/kii/balance/${address}`);
  if (kiiBalance !== null) {
    log.success(`KII (API) : ${kiiBalance?.balance ?? JSON.stringify(kiiBalance)}`);
  }

  // Progress task
  const progress = await apiGet(`/task/progress/${userName}`);
  if (progress) {
    log.divider();
    log.info("📋 Progress Task:");
    const tasks = Array.isArray(progress) ? progress : Object.entries(progress).map(([k,v]) => ({ name: k, ...v }));
    tasks.forEach(t => {
      const status = t.completed || t.done || t.status === "completed" ? chalk.green("✅ Selesai") : chalk.yellow("⏳ Belum");
      log.info(`   ${status} | ${t.taskName || t.name || JSON.stringify(t)}`);
    });
  }

  return userInfo;
}

// ─── CHECK-IN WEBSITE (API) ───────────────────────────────────────────────────
async function websiteCheckIn(userName) {
  log.title("🌐 WEBSITE CHECK-IN (kiichain.io)");
  log.info(`Melakukan check-in untuk username: ${chalk.bold(userName)}`);

  const result = await apiPost("/task/check-in", { userName });

  if (result?.success) {
    log.success(`✅ Website Check-In BERHASIL!`);
    if (result.txHash) {
      log.success(`TX Hash : ${result.txHash}`);
      log.success(`Link    : ${CONFIG.explorer}/tx/${result.txHash}`);
    }
    if (result.points) log.success(`Points  : +${result.points}`);
  } else {
    const msg = result?.errorMessage || "Unknown error";
    if (/already|sudah|cooldown|24/i.test(msg)) {
      log.warn(`Check-in sudah dilakukan hari ini — coba lagi besok.`);
    } else {
      log.warn(`Check-in gagal: ${msg}`);
    }
  }

  return result;
}

// ─── SELF-TRANSFER ONCHAIN ────────────────────────────────────────────────────
async function onchainCheckIn(wallet, amount, txCount) {
  log.title(`⛓️  ONCHAIN TRANSAKSI — ${txCount}x @ ${amount} ${CONFIG.symbol}`);

  const balance = await wallet.provider.getBalance(wallet.address);
  const bal = parseFloat(ethers.formatEther(balance));
  const totalNeeded = (parseFloat(amount) * txCount) + (0.001 * txCount);

  if (bal < totalNeeded) {
    log.warn(`Saldo tidak cukup! Butuh ±${totalNeeded.toFixed(4)} ${CONFIG.symbol}, saldo: ${bal.toFixed(6)}`);
    return [];
  }

  const results = [];
  for (let i = 1; i <= txCount; i++) {
    log.divider();
    log.info(`TX ${i}/${txCount} — mengirim ${amount} ${CONFIG.symbol} ke diri sendiri...`);
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
      if (i < txCount) { log.info("Jeda 3 detik..."); await sleep(3000); }
    } catch (err) {
      log.error(`TX ${i}/${txCount} gagal: ${err.message}`);
      results.push({ status: "failed", error: err.message });
    }
  }

  const ok = results.filter(r => r.status === "success").length;
  log.divider();
  log.success(`Selesai: ${ok}/${txCount} transaksi berhasil`);
  return results;
}

// ─── SIMPAN LOG ───────────────────────────────────────────────────────────────
function saveLog(entry) {
  const logFile = "checkin-log.json";
  let logs = [];
  if (fs.existsSync(logFile)) {
    try { logs = JSON.parse(fs.readFileSync(logFile, "utf8")); } catch {}
  }
  logs.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  return logs.length;
}

// ─── RIWAYAT ──────────────────────────────────────────────────────────────────
function showHistory() {
  log.title("📅 RIWAYAT CHECK-IN");
  const logFile = "checkin-log.json";
  if (!fs.existsSync(logFile)) { log.warn("Belum ada riwayat."); return; }
  try {
    const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
    if (!logs.length) { log.warn("Log kosong."); return; }
    log.success(`Total sesi: ${logs.length}`);
    log.divider();
    logs.slice(-5).forEach((e, i) => {
      const date = new Date(e.date).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const webStatus = e.websiteCheckIn?.success ? chalk.green("✅") : chalk.yellow("⏭️");
      const txOk = e.onchainTx?.filter(r => r.status === "success").length || 0;
      log.info(`Sesi ${logs.length - 4 + i} | ${date}`);
      log.info(`  Website check-in: ${webStatus}  |  Onchain TX: ${txOk}/${e.txCount || 0}x @ ${e.amount || "-"} KII`);
    });
    if (logs.length > 5) log.info(`... dan ${logs.length - 5} sesi sebelumnya`);
  } catch { log.error("Gagal baca log."); }
}

// ─── JALANKAN SEMUA TUGAS ─────────────────────────────────────────────────────
async function runDailyTasks(wallet, userName, amount, txCount) {
  log.title(`🤖 KIICHAIN DAILY BOT — ${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`);

  // 1. Cek saldo & info user
  const walletInfo = await checkWallet(wallet);
  await checkUserInfo(userName, wallet.address);

  // 2. Website check-in (API resmi)
  const webResult = await websiteCheckIn(userName);

  // 3. Onchain transaksi
  const txResults = await onchainCheckIn(wallet, amount, txCount);

  // 4. Saldo akhir
  log.title("💰 SALDO AKHIR");
  await checkWallet(wallet);

  // 5. Simpan log
  const total = saveLog({
    date: new Date().toISOString(),
    userName,
    address: wallet.address,
    amount,
    txCount,
    websiteCheckIn: webResult,
    onchainTx: txResults,
  });
  log.info(`Log disimpan (total sesi: ${total})`);

  showHistory();
  log.success(`\n✅ Semua tugas harian selesai! Sampai besok 🚀\n`);
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
async function main() {
  console.log(chalk.bold.magenta(`
╔═════════════════════════════════════════════════╗
║         🤖  KIICHAIN DAILY BOT                 ║
║             KiiChain Testnet Oro               ║
║  ✅ Website Check-In  ✅ Onchain TX            ║
╚═════════════════════════════════════════════════╝`));

  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith("-"));

  // Private key
  let privateKey = args.find(a => !a.startsWith("-"));
  if (!privateKey) privateKey = await promptSecret("🔑 Masukkan Private Key wallet kamu: ");
  if (!privateKey || privateKey.replace(/^0x/, "").length < 60) {
    log.error("Private key tidak valid!"); process.exit(1);
  }

  // Username KiiChain
  const userName = await askQuestion("👤 Masukkan Username KiiChain kamu: ");
  if (!userName) { log.error("Username tidak boleh kosong!"); process.exit(1); }

  // Koneksi
  const provider = await connectProvider();
  const wallet = createWallet(privateKey, provider);
  log.success(`Wallet   : ${wallet.address}`);
  log.success(`Username : ${userName}\n`);

  // Mode
  if (flags.includes("--check") || flags.includes("-c")) {
    await checkWallet(wallet);
    await checkUserInfo(userName, wallet.address);

  } else if (flags.includes("--checkin") || flags.includes("-i")) {
    await websiteCheckIn(userName);

  } else if (flags.includes("--history") || flags.includes("-h")) {
    showHistory();

  } else {
    // Menu pilihan amount & tx count
    const amount = await selectAmount();
    log.success(`Amount   : ${amount} ${CONFIG.symbol}`);
    const txCount = await selectTxCount();
    log.success(`Jumlah TX: ${txCount}x`);
    log.info(`Estimasi total: ~${(parseFloat(amount) * txCount).toFixed(4)} ${CONFIG.symbol} + gas\n`);

    if (flags.includes("--once") || flags.includes("-o")) {
      await runDailyTasks(wallet, userName, amount, txCount);
    } else {
      // Jalankan sekarang + cron harian
      await runDailyTasks(wallet, userName, amount, txCount);

      log.title("⏰ JADWAL OTOMATIS AKTIF");
      log.info("Bot akan jalan otomatis setiap hari jam 08:00 WIB");
      log.info("Tekan Ctrl+C untuk berhenti\n");

      cron.schedule(CONFIG.cronSchedule, async () => {
        log.info("⏰ Cron harian dimulai...");
        await runDailyTasks(wallet, userName, amount, txCount);
      }, { timezone: "Asia/Jakarta" });
    }
  }
}

main().catch(err => { log.error(`Fatal: ${err.message}`); process.exit(1); });
